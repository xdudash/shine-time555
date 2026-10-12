-- Stage 2, fixes 16, 17 and 24: the client's own voice and the cleaner's money.
--
--  16  a rating and an optional complaint on a finished cleaning
--  17  the client can change the note on a booking and manage recurring bookings
--  24  the cleaner's earnings are answered by the server, not summed in the browser
--
-- The rating feeds st_cleaners.rating, which until now was a default of 5 that
-- nothing ever moved.

-- 1. One feedback row per cleaning, written by the client side.
create table if not exists public.st_job_feedback (
  id bigint generated always as identity primary key,
  job_id bigint not null unique references public.st_jobs(id) on delete cascade,
  client_id bigint references public.st_client_accounts(id) on delete set null,
  cleaner_id bigint references public.st_cleaners(id) on delete set null,
  rating integer not null check (rating between 1 and 5),
  comment text check (comment is null or length(comment) <= 1000),
  complaint boolean not null default false,
  issue_id bigint references public.st_issues(id) on delete set null,
  created_by_user_id bigint not null references public.st_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists st_job_feedback_cleaner_idx on public.st_job_feedback(cleaner_id, created_at desc);
alter table public.st_job_feedback enable row level security;
drop policy if exists st_job_feedback_backend_only on public.st_job_feedback;
create policy st_job_feedback_backend_only on public.st_job_feedback for all to anon, authenticated using (false) with check (false);
revoke all on public.st_job_feedback from anon, authenticated;

-- st_issues.type has no constraint (it is free text written by the cleaner's
-- issue form), so CLIENT_COMPLAINT needs no schema change — only this note so
-- the type is not mistaken for a typo later.

-- How long after the cleaning a client may still rate it.
insert into public.st_settings(setting_key, value_json) values ('feedbackWindowDays','14')
on conflict (setting_key) do nothing;

-- 2. The cleaner's visible rating is the average of real ratings, or the
--    starting 5 while there are none. Recomputed from the table, never nudged.
create or replace function public.st_refresh_cleaner_rating(p_cleaner_id bigint) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if p_cleaner_id is null then return; end if;
  update public.st_cleaners c
    set rating = coalesce((select round(avg(f.rating)::numeric,2) from public.st_job_feedback f where f.cleaner_id=p_cleaner_id),5)
    where c.id = p_cleaner_id;
end $$;

-- 3. Rating and complaint in one command: the client rates, and a complaint
--    additionally opens an issue for operations and notifies staff. Replay safe
--    through the unique job_id, and the same client may correct it inside the
--    feedback window.
create or replace function public.st_submit_job_feedback(p_actor_id bigint, p_job_id bigint, p_body jsonb)
returns public.st_job_feedback
language plpgsql security definer set search_path=public,pg_temp as $$
declare
  u public.st_users%rowtype; j public.st_jobs%rowtype; o public.st_objects%rowtype;
  ca public.st_client_accounts%rowtype; f public.st_job_feedback%rowtype;
  v_rating int; v_comment text; v_complaint boolean; v_window int; v_issue bigint;
begin
  select * into strict u from public.st_users where id=p_actor_id and active;
  if u.role not in ('OWNER','PROPERTY_MANAGER') then raise exception 'Only the client side can rate a cleaning'; end if;
  select * into strict j from public.st_jobs where id=p_job_id;
  select * into strict o from public.st_objects where id=j.object_id;
  select * into ca from public.st_client_accounts where user_id=u.id;
  if not found then raise exception 'Forbidden'; end if;
  if not ((u.role='OWNER' and ca.id=j.client_id)
       or (u.role='PROPERTY_MANAGER' and exists(select 1 from public.st_manager_properties mp where mp.manager_client_id=ca.id and mp.object_id=j.object_id)))
    then raise exception 'Forbidden'; end if;
  if j.status <> 'COMPLETED' then raise exception 'Only a finished cleaning can be rated'; end if;

  v_window := greatest(1, coalesce((select value_json::text::int from public.st_settings where setting_key='feedbackWindowDays'),14));
  if coalesce(j.completed_at, j.service_date::timestamptz) < now() - make_interval(days => v_window) then
    raise exception 'The rating window for this cleaning has closed (% days)', v_window;
  end if;

  v_rating := (p_body->>'rating')::int;
  if v_rating is null or v_rating < 1 or v_rating > 5 then raise exception 'A rating from 1 to 5 is required'; end if;
  v_comment := nullif(left(btrim(coalesce(p_body->>'comment','')),1000),'');
  v_complaint := coalesce((p_body->>'complaint')::boolean,false);
  if v_complaint and v_comment is null then raise exception 'A complaint needs a description'; end if;

  if v_complaint then
    insert into public.st_issues(job_id, cleaner_id, type, description, priority, status)
      values(p_job_id, j.assigned_cleaner_id, 'CLIENT_COMPLAINT', v_comment, 'HIGH', 'OPEN')
      returning id into v_issue;
    perform public.st_notify_staff('COMPLAINT','Client complaint', o.code||' · #'||j.id||' · '||v_rating||'/5');
  end if;

  insert into public.st_job_feedback(job_id, client_id, cleaner_id, rating, comment, complaint, issue_id, created_by_user_id)
    values(p_job_id, j.client_id, j.assigned_cleaner_id, v_rating, v_comment, v_complaint, v_issue, u.id)
    on conflict (job_id) do update
      set rating=excluded.rating, comment=excluded.comment,
          complaint=public.st_job_feedback.complaint or excluded.complaint,
          issue_id=coalesce(public.st_job_feedback.issue_id, excluded.issue_id),
          updated_at=now()
    returning * into f;

  perform public.st_refresh_cleaner_rating(j.assigned_cleaner_id);
  insert into public.st_job_events(job_id,user_id,event_type,payload_json)
    values(p_job_id,u.id,case when v_complaint then 'CLIENT_COMPLAINT' else 'CLIENT_RATED' end,
           jsonb_build_object('rating',v_rating,'complaint',v_complaint));
  if not v_complaint and v_rating <= 2 then
    perform public.st_notify_staff('LOW_RATING','Low rating from a client', o.code||' · #'||j.id||' · '||v_rating||'/5');
  end if;
  return f;
end $$;

-- 4. The client may correct the note on a booking while it can still help:
--    until the cleaner has arrived.
create or replace function public.st_update_booking_note(p_actor_id bigint, p_job_id bigint, p_note text)
returns public.st_jobs
language plpgsql security definer set search_path=public,pg_temp as $$
declare u public.st_users%rowtype; j public.st_jobs%rowtype; ca public.st_client_accounts%rowtype;
begin
  select * into strict u from public.st_users where id=p_actor_id and active;
  select * into strict j from public.st_jobs where id=p_job_id for update;
  if u.role in ('ADMIN','OPERATIONS_MANAGER') then
    null;
  elsif u.role in ('OWNER','PROPERTY_MANAGER') then
    select * into ca from public.st_client_accounts where user_id=u.id;
    if not found then raise exception 'Forbidden'; end if;
    if not ((u.role='OWNER' and ca.id=j.client_id)
         or (u.role='PROPERTY_MANAGER' and exists(select 1 from public.st_manager_properties mp where mp.manager_client_id=ca.id and mp.object_id=j.object_id)))
      then raise exception 'Forbidden'; end if;
    if j.status in ('ARRIVED','CLEANING','COMPLETED','CANCELLED','EXPIRED') then
      raise exception 'The cleaner is already at the property; contact Operations';
    end if;
  else
    raise exception 'Forbidden';
  end if;
  update public.st_jobs set client_note=nullif(left(btrim(coalesce(p_note,'')),1000),'') where id=p_job_id returning * into j;
  insert into public.st_job_events(job_id,user_id,event_type,payload_json)
    values(p_job_id,u.id,'NOTE_UPDATED',jsonb_build_object('length',coalesce(length(j.client_note),0)));
  if j.assigned_cleaner_id is not null then
    insert into public.st_notifications(user_id,type,title,message)
      select cl.user_id,'NOTE_UPDATED','The client changed the note','#'||j.id
      from public.st_cleaners cl where cl.id=j.assigned_cleaner_id;
  end if;
  return j;
end $$;

-- 5. Recurring bookings the client manages. The worker that turns them into
--    cleanings already exists; this only opens the schedule to its owner.
create or replace function public.st_client_recurring(p_actor_id bigint) returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare u public.st_users%rowtype; ca public.st_client_accounts%rowtype;
begin
  select * into strict u from public.st_users where id=p_actor_id and active;
  if u.role not in ('OWNER','PROPERTY_MANAGER') then raise exception 'Forbidden'; end if;
  select * into ca from public.st_client_accounts where user_id=u.id;
  if not found then return jsonb_build_object('schedules','[]'::jsonb); end if;
  return jsonb_build_object('schedules', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id',r.id,'object_id',r.object_id,'object_code',o.code,'object_name',o.name,
      'start_date',r.start_date,'end_date',r.end_date,'weekdays',r.weekdays,
      'planned_start',r.planned_start,'active',r.active,
      'generated', (select count(*) from public.st_jobs j where j.recurring_id=r.id)
    ) order by r.id desc)
    from public.st_recurring r join public.st_objects o on o.id=r.object_id
    where (u.role='OWNER' and o.client_id=ca.id)
       or (u.role='PROPERTY_MANAGER' and exists(select 1 from public.st_manager_properties mp where mp.manager_client_id=ca.id and mp.object_id=o.id))
  ),'[]'::jsonb));
end $$;

create or replace function public.st_client_recurring_save(p_actor_id bigint, p_body jsonb) returns public.st_recurring
language plpgsql security definer set search_path=public,pg_temp as $$
declare
  u public.st_users%rowtype; ca public.st_client_accounts%rowtype; o public.st_objects%rowtype;
  r public.st_recurring%rowtype; v_id bigint; v_days int[]; v_start date; v_end date; v_time time;
begin
  select * into strict u from public.st_users where id=p_actor_id and active;
  if u.role not in ('OWNER','PROPERTY_MANAGER') then raise exception 'Forbidden'; end if;
  select * into ca from public.st_client_accounts where user_id=u.id;
  if not found then raise exception 'Forbidden'; end if;
  select * into o from public.st_objects where id=(p_body->>'objectId')::bigint and active and approval_status='APPROVED';
  if not found then raise exception 'Property is not approved for booking'; end if;
  if not ((u.role='OWNER' and o.client_id=ca.id)
       or (u.role='PROPERTY_MANAGER' and exists(select 1 from public.st_manager_properties mp where mp.manager_client_id=ca.id and mp.object_id=o.id)))
    then raise exception 'Forbidden'; end if;

  select array_agg(distinct value::int order by value::int) into v_days
    from jsonb_array_elements_text(coalesce(p_body->'weekdays','[]'::jsonb)) value;
  if v_days is null or cardinality(v_days)=0 or not (v_days <@ array[1,2,3,4,5,6,7]) then
    raise exception 'Choose at least one weekday';
  end if;
  v_start := coalesce((p_body->>'startDate')::date, (now() at time zone 'Europe/Bratislava')::date);
  v_end := nullif(p_body->>'endDate','')::date;
  if v_end is not null and v_end < v_start then raise exception 'The end date is before the start date'; end if;
  v_time := coalesce(nullif(p_body->>'plannedStart','')::time, o.checkout_time);
  if v_time >= o.deadline_time then raise exception 'The start is outside the property window'; end if;

  v_id := nullif(p_body->>'id','')::bigint;
  if v_id is not null then
    select * into strict r from public.st_recurring where id=v_id;
    if r.object_id <> o.id then raise exception 'A schedule cannot be moved to another property'; end if;
    update public.st_recurring set start_date=v_start, end_date=v_end, weekdays=v_days, planned_start=v_time,
      active=coalesce((p_body->>'active')::boolean, r.active) where id=v_id returning * into r;
  else
    insert into public.st_recurring(object_id, created_by_user_id, start_date, end_date, weekdays, planned_start, active)
      values(o.id, u.id, v_start, v_end, v_days, v_time, coalesce((p_body->>'active')::boolean,true)) returning * into r;
  end if;
  return r;
end $$;

create or replace function public.st_client_recurring_delete(p_actor_id bigint, p_id bigint) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare u public.st_users%rowtype; ca public.st_client_accounts%rowtype; sched public.st_recurring%rowtype; used int; touched int;
begin
  select * into strict u from public.st_users where id=p_actor_id and active;
  if u.role not in ('OWNER','PROPERTY_MANAGER') then raise exception 'Forbidden'; end if;
  select * into ca from public.st_client_accounts where user_id=u.id;
  if not found then raise exception 'Forbidden'; end if;
  select r.* into sched from public.st_recurring r join public.st_objects o on o.id=r.object_id
    where r.id=p_id
      and ((u.role='OWNER' and o.client_id=ca.id)
        or (u.role='PROPERTY_MANAGER' and exists(select 1 from public.st_manager_properties mp where mp.manager_client_id=ca.id and mp.object_id=o.id)));
  if not found then raise exception 'Schedule not found'; end if;

  -- st_jobs.recurring_id tells which schedule produced a cleaning, and that
  -- history is worth more than a tidy table: a schedule that has already
  -- generated cleanings is switched off instead of deleted, so the link stays
  -- readable. An unused schedule is removed outright.
  select count(*) into used from public.st_jobs j where j.recurring_id=sched.id;
  if used > 0 then
    update public.st_recurring set active=false where id=sched.id;
    get diagnostics touched = row_count;
    return jsonb_build_object('deleted',0,'deactivated',touched,'generatedJobs',used);
  end if;
  delete from public.st_recurring where id=sched.id;
  get diagnostics touched = row_count;
  return jsonb_build_object('deleted',touched,'deactivated',0,'generatedJobs',0);
end $$;

-- 6. The cleaner's earnings, answered by the database so the browser never has
--    to add money up: this week, this month, waiting for review, already paid.
create or replace function public.st_cleaner_earnings(p_actor_id bigint) returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare
  u public.st_users%rowtype; c public.st_cleaners%rowtype;
  d date := (now() at time zone 'Europe/Bratislava')::date;
  week_start date; month_start date;
begin
  select * into strict u from public.st_users where id=p_actor_id and active;
  if u.role <> 'CLEANER' then raise exception 'Forbidden'; end if;
  select * into strict c from public.st_cleaners where user_id=u.id and active;
  week_start := d - ((extract(isodow from d)::int) - 1);
  month_start := date_trunc('month', d)::date;
  return (
    with mine as (
      select j.*, round((j.payout + j.bonus) * 100)::bigint as earned_cents
      from public.st_jobs j where j.assigned_cleaner_id = c.id and j.status = 'COMPLETED'
    ), paid as (
      select s.job_id, sum(case s.kind when 'CLEANER_PAYOUT' then s.amount_cents when 'CLEANER_RETURN' then -s.amount_cents else 0 end)::bigint as paid_cents
      from public.st_settlements s group by s.job_id
    ), rows as (
      select m.*, coalesce(p.paid_cents,0) as paid_cents from mine m left join paid p on p.job_id = m.id
    )
    select jsonb_build_object(
      'today', coalesce((select sum(earned_cents) from rows where service_date = d),0),
      'week', coalesce((select sum(earned_cents) from rows where service_date >= week_start),0),
      'month', coalesce((select sum(earned_cents) from rows where service_date >= month_start),0),
      'waitingReview', coalesce((select sum(earned_cents - paid_cents) from rows where review_status <> 'APPROVED'),0),
      'payable', coalesce((select sum(greatest(earned_cents - paid_cents,0)) from rows where review_status = 'APPROVED'),0),
      'paid', coalesce((select sum(paid_cents) from rows),0),
      'completedWeek', (select count(*) from rows where service_date >= week_start),
      'completedMonth', (select count(*) from rows where service_date >= month_start),
      'rating', c.rating,
      'reliability', c.reliability_score,
      'weekStart', week_start,
      'monthStart', month_start)
  );
end $$;

revoke all on function public.st_submit_job_feedback(bigint,bigint,jsonb) from public,anon,authenticated;
revoke all on function public.st_update_booking_note(bigint,bigint,text) from public,anon,authenticated;
revoke all on function public.st_client_recurring(bigint) from public,anon,authenticated;
revoke all on function public.st_client_recurring_save(bigint,jsonb) from public,anon,authenticated;
revoke all on function public.st_client_recurring_delete(bigint,bigint) from public,anon,authenticated;
revoke all on function public.st_cleaner_earnings(bigint) from public,anon,authenticated;
revoke all on function public.st_refresh_cleaner_rating(bigint) from public,anon,authenticated;
grant execute on function public.st_submit_job_feedback(bigint,bigint,jsonb) to service_role;
grant execute on function public.st_update_booking_note(bigint,bigint,text) to service_role;
grant execute on function public.st_client_recurring(bigint) to service_role;
grant execute on function public.st_client_recurring_save(bigint,jsonb) to service_role;
grant execute on function public.st_client_recurring_delete(bigint,bigint) to service_role;
grant execute on function public.st_cleaner_earnings(bigint) to service_role;
