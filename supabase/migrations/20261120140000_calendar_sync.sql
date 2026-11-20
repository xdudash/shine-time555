-- Airbnb / Booking.com calendar sync (owner request 2026-11-20).
-- An owner pastes the iCal export link of a listing into the property. st-api fetches it on a
-- schedule, parses the reservations and hands them to st_sync_calendar(), which keeps a list of
-- stays and, when the calendar allows it, books the check-out cleaning automatically.
-- iCal carries dates only (no guest names or times), so the cleaning uses the property's own
-- check-out and deadline times. Links contain private tokens and are readable by service_role only.

create table if not exists public.st_object_calendars (
  id bigserial primary key,
  object_id bigint not null references public.st_objects(id) on delete cascade,
  source text not null check (source in ('AIRBNB','BOOKING','OTHER')),
  url text not null check (url ~ '^https://' and length(url) <= 2000),
  auto_create boolean not null default true,
  active boolean not null default true,
  created_by_user_id bigint references public.st_users(id),
  created_at timestamptz not null default now(),
  last_synced_at timestamptz,
  last_status text check (last_status in ('OK','ERROR')),
  last_error text,
  last_summary jsonb
);
create unique index if not exists st_object_calendars_url_uidx on public.st_object_calendars(object_id, url) where active;
create index if not exists st_object_calendars_due_idx on public.st_object_calendars(last_synced_at) where active;
alter table public.st_object_calendars enable row level security;
revoke all on public.st_object_calendars from anon, authenticated;

create table if not exists public.st_stays (
  id bigserial primary key,
  calendar_id bigint not null references public.st_object_calendars(id) on delete cascade,
  object_id bigint not null references public.st_objects(id) on delete cascade,
  uid text not null,
  check_in date not null,
  check_out date not null check (check_out > check_in),
  summary text,
  status text not null default 'ACTIVE' check (status in ('ACTIVE','CANCELLED')),
  job_id bigint references public.st_jobs(id) on delete set null,
  last_error text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  cancelled_at timestamptz,
  unique (calendar_id, uid)
);
create index if not exists st_stays_object_dates_idx on public.st_stays(object_id, check_out);
alter table public.st_stays enable row level security;
revoke all on public.st_stays from anon, authenticated;

-- Cancels a cleaning a calendar created when nobody has taken it yet. Returns true when cancelled.
create or replace function public.st_calendar_release_job(p_job_id bigint, p_reason text) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare j public.st_jobs%rowtype;
begin
  select * into j from public.st_jobs where id = p_job_id for update;
  if not found then return false; end if;
  if j.status not in ('UNASSIGNED','OFFERED','AT_RISK','RESCUE') or j.assigned_cleaner_id is not null then return false; end if;
  update public.st_jobs set status = 'CANCELLED', marketplace_visible = false, cancellation_reason = left(p_reason, 300) where id = j.id;
  insert into public.st_job_events(job_id, event_type, payload_json) values (j.id, 'CALENDAR_CANCELLED', jsonb_build_object('reason', p_reason));
  return true;
end $$;
revoke all on function public.st_calendar_release_job(bigint, text) from public, anon, authenticated;

-- Applies one fetch of a calendar. p_events: [{uid, checkIn:'YYYY-MM-DD', checkOut:'YYYY-MM-DD', summary}]
-- (already filtered to reservations). On a failed fetch pass p_error and no events: stays are kept.
create or replace function public.st_sync_calendar(p_calendar_id bigint, p_events jsonb, p_error text default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  cal public.st_object_calendars%rowtype;
  o public.st_objects%rowtype;
  today_local date := (now() at time zone 'Europe/Bratislava')::date;
  horizon int := 45; -- days ahead to book check-out cleanings; later ones are booked on later syncs
  e jsonb; s public.st_stays%rowtype; j public.st_jobs%rowtype;
  v_uid text; v_in date; v_out date; v_summary text;
  actor bigint; existing bigint; label text;
  seen text[] := '{}';
  n_stays int := 0; n_new int := 0; n_created int := 0; n_linked int := 0; n_cancelled int := 0; n_changed int := 0; n_errors int := 0;
  answer jsonb;
begin
  select * into cal from public.st_object_calendars where id = p_calendar_id for update;
  if not found or not cal.active then raise exception 'Calendar not found'; end if;
  label := case cal.source when 'AIRBNB' then 'Airbnb' when 'BOOKING' then 'Booking.com' else 'Calendar' end;

  if p_error is not null then
    update public.st_object_calendars set last_synced_at = now(), last_status = 'ERROR', last_error = left(p_error, 500) where id = cal.id;
    return jsonb_build_object('error', p_error);
  end if;
  if p_events is null or jsonb_typeof(p_events) <> 'array' then raise exception 'Events must be an array'; end if;
  if jsonb_array_length(p_events) > 2000 then raise exception 'Too many events in one calendar'; end if;

  select * into o from public.st_objects where id = cal.object_id;
  -- Cleanings are booked as the property's owner, so client prices and notifications apply as for
  -- any client booking. Without an active owner, the first active administrator books them.
  select u.id into actor from public.st_client_accounts ca join public.st_users u on u.id = ca.user_id
   where ca.id = o.client_id and u.active and u.role = 'OWNER';
  if actor is null then select id into actor from public.st_users where active and role = 'ADMIN' order by id limit 1; end if;

  for e in select * from jsonb_array_elements(p_events) loop
    v_uid := left(btrim(coalesce(e->>'uid', '')), 300);
    if v_uid = '' or coalesce(e->>'checkIn', '') !~ '^\d{4}-\d{2}-\d{2}$' or coalesce(e->>'checkOut', '') !~ '^\d{4}-\d{2}-\d{2}$' then continue; end if;
    v_in := (e->>'checkIn')::date; v_out := (e->>'checkOut')::date;
    if v_out <= v_in then continue; end if;
    v_summary := left(nullif(btrim(coalesce(e->>'summary', '')), ''), 200);
    seen := seen || v_uid;
    n_stays := n_stays + 1;

    select * into s from public.st_stays where calendar_id = cal.id and uid = v_uid for update;
    if not found then
      insert into public.st_stays(calendar_id, object_id, uid, check_in, check_out, summary)
      values (cal.id, cal.object_id, v_uid, v_in, v_out, v_summary) returning * into s;
      n_new := n_new + 1;
    else
      if s.check_out <> v_out and s.job_id is not null then
        -- The guest moved the check-out: release the old cleaning if nobody took it, else tell staff.
        if public.st_calendar_release_job(s.job_id, label || ': guest dates changed') then
          s.job_id := null;
        else
          perform public.st_notify_staff('CALENDAR_CHANGE', 'Guest dates changed for an assigned cleaning', o.code || ' · #' || s.job_id || ' · ' || to_char(v_out, 'DD.MM'));
        end if;
        n_changed := n_changed + 1;
      end if;
      update public.st_stays set check_in = v_in, check_out = v_out, summary = v_summary, status = 'ACTIVE',
        cancelled_at = null, last_seen_at = now(), job_id = s.job_id
       where id = s.id returning * into s;
    end if;

    -- Book the check-out cleaning once, inside the horizon, for future check-outs only.
    if cal.auto_create and s.job_id is null and s.check_out >= today_local and s.check_out <= today_local + horizon
       and o.active and o.approval_status = 'APPROVED' then
      select id into existing from public.st_jobs
       where object_id = o.id and service_date = s.check_out and status not in ('CANCELLED','EXPIRED') order by id limit 1;
      if existing is not null then
        -- Another calendar or a manual booking already covers this check-out.
        update public.st_stays set job_id = existing, last_error = null where id = s.id;
        n_linked := n_linked + 1;
      elsif actor is null then
        update public.st_stays set last_error = 'No active owner or administrator to book the cleaning' where id = s.id;
        n_errors := n_errors + 1;
      else
        begin
          j := public.st_create_job(actor, jsonb_build_object('objectId', o.id, 'serviceDate', s.check_out,
                 'note', 'Guest check-out · ' || label));
          update public.st_jobs set booking_source = 'CALENDAR' where id = j.id;
          insert into public.st_job_events(job_id, event_type, payload_json)
          values (j.id, 'CALENDAR_BOOKED', jsonb_build_object('calendarId', cal.id, 'stayId', s.id, 'source', cal.source, 'checkIn', s.check_in, 'checkOut', s.check_out));
          update public.st_stays set job_id = j.id, last_error = null where id = s.id;
          n_created := n_created + 1;
        exception when others then
          update public.st_stays set last_error = left(sqlerrm, 300) where id = s.id;
          n_errors := n_errors + 1;
        end;
      end if;
    end if;
  end loop;

  -- A future stay that left the feed was cancelled by the guest or the platform.
  for s in select * from public.st_stays
    where calendar_id = cal.id and status = 'ACTIVE' and check_out >= today_local and not (uid = any(seen)) for update loop
    update public.st_stays set status = 'CANCELLED', cancelled_at = now() where id = s.id;
    n_cancelled := n_cancelled + 1;
    if s.job_id is not null and not exists (
      select 1 from public.st_stays other where other.job_id = s.job_id and other.id <> s.id and other.status = 'ACTIVE'
    ) then
      if not public.st_calendar_release_job(s.job_id, label || ': booking cancelled') then
        perform public.st_notify_staff('CALENDAR_CHANGE', 'Guest booking cancelled for an assigned cleaning', o.code || ' · #' || s.job_id);
      end if;
    end if;
  end loop;

  answer := jsonb_build_object('stays', n_stays, 'new', n_new, 'created', n_created, 'linked', n_linked,
    'cancelled', n_cancelled, 'changed', n_changed, 'errors', n_errors);
  update public.st_object_calendars set last_synced_at = now(), last_status = 'OK', last_error = null, last_summary = answer where id = cal.id;
  return answer;
end $$;
revoke all on function public.st_sync_calendar(bigint, jsonb, text) from public, anon, authenticated;
grant execute on function public.st_sync_calendar(bigint, jsonb, text) to service_role;
