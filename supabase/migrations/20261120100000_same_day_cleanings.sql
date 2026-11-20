-- Two cleanings at one property on one day (owner decision of 2026-11-20).
-- Short-term rentals turn over more than once a day: a check-out in the morning and another in the
-- evening. The old rule allowed one active cleaning per property per day, so six real same-day
-- cleanings from the CRM export could not be recorded.
-- New rule: a new booking is refused only when its time window overlaps another active cleaning at
-- the same property. Past cleanings entered by hand and finance corrections carry no time of day,
-- so they may share a date. Repeating schedules still create at most one cleaning a day.

drop index if exists public.st_jobs_one_active_per_object_day;
create index if not exists st_jobs_object_day_idx on public.st_jobs(object_id, service_date) where status not in ('CANCELLED','EXPIRED');

create or replace function public.st_create_job(p_actor_id bigint,p_body jsonb) returns public.st_jobs
language plpgsql security definer set search_path=public,pg_temp as $$
declare
 u st_users%rowtype;o st_objects%rowtype;j st_jobs%rowtype;
 d date;start_at time;end_at time;duration integer;is_client boolean;
begin
 select * into strict u from st_users where id=p_actor_id and active;
 if u.role not in ('ADMIN','OPERATIONS_MANAGER','OWNER','PROPERTY_MANAGER') then raise exception 'Forbidden';end if;
 select * into o from st_objects where id=(p_body->>'objectId')::bigint and active and approval_status='APPROVED';
 if not found then raise exception 'Property is not approved for booking';end if;
 is_client:=u.role in ('OWNER','PROPERTY_MANAGER');
 if is_client and not exists(select 1 from st_client_accounts ca where ca.user_id=u.id and
   ((u.role='OWNER' and ca.id=o.client_id) or (u.role='PROPERTY_MANAGER' and exists(select 1 from st_manager_properties mp where mp.manager_client_id=ca.id and mp.object_id=o.id)))) then raise exception 'Forbidden';end if;
 d:=(p_body->>'serviceDate')::date;
 if d is null or d<(now() at time zone 'Europe/Bratislava')::date or d>(now() at time zone 'Europe/Bratislava')::date+366 then raise exception 'Invalid service date';end if;
 start_at:=coalesce(nullif(p_body->>'earliestStart','')::time,nullif(p_body->>'plannedStart','')::time,o.checkout_time);
 end_at:=coalesce(nullif(p_body->>'deadline','')::time,o.deadline_time);
 duration:=case when is_client then o.duration_minutes else coalesce((p_body->>'durationMinutes')::int,o.duration_minutes) end;
 if duration<15 or duration>1440 or start_at>=end_at or d+start_at+make_interval(mins=>duration)>d+end_at then raise exception 'The window is too short for this cleaning (% min)',duration;end if;
 if d=(now() at time zone 'Europe/Bratislava')::date and (now() at time zone 'Europe/Bratislava')::time+make_interval(mins=>duration)>end_at then raise exception 'Not enough time left today for this window';end if;
 perform pg_advisory_xact_lock(hashtext(d::text));
 -- Two cleanings on one day are allowed (check-out, check-in, check-out); their windows may not overlap.
 if exists(select 1 from st_jobs where object_id=o.id and service_date=d and status not in ('CANCELLED','EXPIRED') and earliest_start<end_at and deadline>start_at) then raise exception 'Another cleaning at this property overlaps this time window';end if;
 insert into st_jobs(object_id,client_id,service_date,earliest_start,deadline,duration_minutes,payout,client_price,bonus,planned_start,eta,booking_source,created_by_user_id,status,marketplace_visible,client_note)
 values(o.id,o.client_id,d,start_at,end_at,duration,
   case when is_client or u.role='OPERATIONS_MANAGER' then o.payout else coalesce((p_body->>'payout')::numeric,o.payout) end,
   case when is_client or u.role='OPERATIONS_MANAGER' then o.client_price else coalesce((p_body->>'clientPrice')::numeric,o.client_price) end,
   case when is_client then 0 else greatest(0,coalesce((p_body->>'bonus')::numeric,0)) end,
   null,null,case when is_client then 'CLIENT' else 'ADMIN' end,u.id,'UNASSIGNED',
   case when is_client then true else coalesce((p_body->>'marketplaceVisible')::boolean,true) end,
   nullif(left(btrim(coalesce(p_body->>'note','')),1000),'')) returning * into j;
 if j.payout<0 or j.client_price<0 then raise exception 'Negative amount is not allowed';end if;
 insert into st_job_checklist(job_id,checklist_item_id,label,required,photo_required,photo_category,sort_order)
 select j.id,id,label,required,photo_required,photo_category,sort_order from st_checklist_items where object_id=o.id;
 if not found then
   insert into st_job_checklist(job_id,label,required,photo_required,photo_category,sort_order) values
   (j.id,'Complete property instructions',true,false,null,1),(j.id,'Final quality inspection',true,false,null,2),(j.id,'Final proof photo',true,true,'Final',3);
 end if;
 insert into st_job_events(job_id,user_id,event_type,payload_json) values(j.id,u.id,case when is_client then 'CLIENT_BOOKED' else 'JOB_CREATED' end,jsonb_build_object('source',j.booking_source,'window',start_at::text||'-'||end_at::text));
 if j.marketplace_visible then
   insert into st_notifications(user_id,type,title,message)
   select cl.user_id,'MARKETPLACE','New cleaning available',o.zone||' · '||to_char(d,'DD.MM')||' '||to_char(start_at,'HH24:MI')||'–'||to_char(end_at,'HH24:MI')
   from st_cleaners cl join st_users cu on cu.id=cl.user_id and cu.active where cl.active;
 end if;
 if is_client then perform st_notify_staff('CLIENT_BOOKING','New client booking',o.code||' · '||to_char(d,'DD.MM')||' '||to_char(start_at,'HH24:MI')||'–'||to_char(end_at,'HH24:MI'));end if;
 return j;
end $$;
revoke all on function public.st_create_job(bigint,jsonb) from public,anon,authenticated;
grant execute on function public.st_create_job(bigint,jsonb) to service_role;

create or replace function public.st_create_manual_completed_job(p_actor_id bigint, p_body jsonb)
returns public.st_jobs
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  u st_users%rowtype;
  o st_objects%rowtype;
  j st_jobs%rowtype;
  d date;
  today_local date := (now() at time zone 'Europe/Bratislava')::date;
  client_price numeric;
  payout numeric;
  cleaner_id bigint;
begin
  select * into strict u from st_users where id = p_actor_id and active;
  if u.role <> 'ADMIN' then raise exception 'Forbidden'; end if;

  select * into o from st_objects
   where id = (p_body->>'objectId')::bigint and active and approval_status = 'APPROVED';
  if not found then raise exception 'Property is not approved for booking'; end if;

  d := (p_body->>'serviceDate')::date;
  if d is null or d > today_local or d < today_local - 366 then
    raise exception 'Enter a past service date (up to one year back)';
  end if;

  client_price := (p_body->>'clientPrice')::numeric;
  payout := (p_body->>'payout')::numeric;
  if client_price is null or client_price < 0 or client_price > 100000 then
    raise exception 'Enter a valid client price';
  end if;
  if payout is null or payout < 0 or payout > 100000 then
    raise exception 'Enter a valid cleaner payout';
  end if;

  cleaner_id := (p_body->>'cleanerId')::bigint;
  if cleaner_id is null or not exists (
    select 1 from st_cleaners c join st_users cu on cu.id = c.user_id
     where c.id = cleaner_id and cu.active
  ) then
    raise exception 'Choose the cleaner who did the work';
  end if;

  -- A second cleaning on the same date is a real second visit (two check-outs in one day).
  perform pg_advisory_xact_lock(hashtext(d::text));

  insert into st_jobs(
    object_id, client_id, service_date, earliest_start, deadline, duration_minutes,
    payout, client_price, bonus, planned_start, eta, booking_source, created_by_user_id,
    status, marketplace_visible, client_note, assigned_cleaner_id, completed_at,
    completion_counted, review_status, review_version, reviewed_at, reviewed_by_user_id, review_note
  ) values (
    o.id, o.client_id, d, o.checkout_time, o.deadline_time, o.duration_minutes,
    payout, client_price, 0, null, null, 'ADMIN', u.id,
    'COMPLETED', false, null, cleaner_id,
    (d + coalesce(o.deadline_time, time '18:00')) at time zone 'Europe/Bratislava',
    true, 'APPROVED', 0, now(), u.id, 'Entered manually'
  ) returning * into j;

  insert into st_job_events(job_id, user_id, event_type, payload_json)
  values (j.id, u.id, 'MANUAL_ENTRY', jsonb_build_object('clientPrice', client_price, 'payout', payout));

  return j;
end
$fn$;

revoke all on function public.st_create_manual_completed_job(bigint, jsonb) from public, anon, authenticated;
grant execute on function public.st_create_manual_completed_job(bigint, jsonb) to service_role;

create or replace function public.st_correct_completed_job_finance(
  p_actor_id bigint, p_job_id bigint, p_body jsonb
) returns public.st_jobs
language plpgsql security definer set search_path=public,pg_temp as $$
declare
  actor public.st_users%rowtype;
  job public.st_jobs%rowtype;
  old_service_date date;
  corrected_date date;
  client_total_cents bigint;
  cleaner_total_cents bigint;
  corrected_client_price numeric(12,2);
  corrected_payout numeric(12,2);
  client_net bigint;
  cleaner_net bigint;
  has_history boolean;
begin
  select * into strict actor from public.st_users where id=p_actor_id and active;
  if actor.role<>'ADMIN' then raise exception 'Forbidden'; end if;

  select * into strict job from public.st_jobs where id=p_job_id for update;
  if job.status<>'COMPLETED' or job.review_status<>'APPROVED' then raise exception 'Only quality-approved completed cleanings can be corrected'; end if;

  if coalesce(p_body->>'serviceDate','') !~ '^\d{4}-\d{2}-\d{2}$'
     or coalesce(p_body->>'clientAmountCents','') !~ '^(0|[1-9][0-9]{0,8})$'
     or coalesce(p_body->>'cleanerAmountCents','') !~ '^(0|[1-9][0-9]{0,8})$' then
    raise exception 'Enter a valid date and non-negative amounts';
  end if;
  corrected_date := (p_body->>'serviceDate')::date;
  client_total_cents := (p_body->>'clientAmountCents')::bigint;
  cleaner_total_cents := (p_body->>'cleanerAmountCents')::bigint;

  corrected_client_price := round(client_total_cents::numeric/100 - job.extra_revenue, 2);
  corrected_payout := round(cleaner_total_cents::numeric/100 - job.bonus, 2);
  if corrected_client_price<0 or corrected_payout<0 then
    raise exception 'Total cannot be lower than the existing extra charge or cleaner bonus';
  end if;

  select coalesce(sum(case kind when 'CLIENT_PAYMENT' then amount_cents when 'CLIENT_REFUND' then -amount_cents else 0 end), 0),
         coalesce(sum(case kind when 'CLEANER_PAYOUT' then amount_cents when 'CLEANER_RETURN' then -amount_cents else 0 end), 0),
         exists(select 1 from public.st_settlements where job_id=job.id)
    into client_net, cleaner_net, has_history
    from public.st_settlements where job_id=job.id;
  if client_total_cents < client_net then
    raise exception 'The client has already paid more than this total. Reverse the payment first';
  end if;
  if cleaner_total_cents < cleaner_net then
    raise exception 'The cleaner has already been paid more than this total. Reverse the payout first';
  end if;

  old_service_date := job.service_date;
  insert into public.st_job_events(job_id,user_id,event_type,payload_json)
  values(job.id,actor.id,'FINANCE_CORRECTION',jsonb_build_object(
    'before',jsonb_build_object(
      'serviceDate',old_service_date,
      'clientAmountCents',round((job.client_price+job.extra_revenue)*100)::bigint,
      'cleanerAmountCents',round((job.payout+job.bonus)*100)::bigint
    ),
    'after',jsonb_build_object(
      'serviceDate',corrected_date,
      'clientAmountCents',client_total_cents,
      'cleanerAmountCents',cleaner_total_cents
    )
  ));
  update public.st_jobs
    set service_date=corrected_date, client_price=corrected_client_price, payout=corrected_payout,
        financial_status = case when has_history then
          (case when client_net >= client_total_cents then 'PAID' else 'INVOICED' end) else financial_status end
    where id=job.id returning * into job;
  return job;
end;
$$;
revoke all on function public.st_correct_completed_job_finance(bigint, bigint, jsonb) from public, anon, authenticated;
grant execute on function public.st_correct_completed_job_finance(bigint, bigint, jsonb) to service_role;

-- Safety net for edits: an open cleaning moved onto another open cleaning's window at the same
-- property is refused, as the old one-per-day index used to refuse it. Finished and cancelled
-- cleanings are history and are never compared.
create or replace function public.st_jobs_no_overlap() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if new.status in ('CANCELLED','EXPIRED','COMPLETED') then return new; end if;
  if exists(
    select 1 from public.st_jobs other
     where other.id <> new.id and other.object_id = new.object_id and other.service_date = new.service_date
       and other.status not in ('CANCELLED','EXPIRED','COMPLETED')
       and other.earliest_start < new.deadline and other.deadline > new.earliest_start
  ) then
    raise exception 'Another cleaning at this property overlaps this time window' using errcode = '23P01';
  end if;
  return new;
end $$;
revoke all on function public.st_jobs_no_overlap() from public, anon, authenticated;

drop trigger if exists st_jobs_no_overlap on public.st_jobs;
create trigger st_jobs_no_overlap
  before insert or update of object_id, service_date, earliest_start, deadline, status on public.st_jobs
  for each row execute function public.st_jobs_no_overlap();
