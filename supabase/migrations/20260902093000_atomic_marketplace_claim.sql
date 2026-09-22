-- A cleaner can have multiple browser tabs or devices.  Serializing claims
-- by cleaner makes the daily limit and time-window checks race-safe without
-- holding locks across network requests.

create index if not exists st_jobs_cleaner_day_active_idx
  on public.st_jobs (assigned_cleaner_id, service_date, planned_start)
  where status <> 'CANCELLED';

create or replace function public.st_claim_marketplace_job(
  p_cleaner_id bigint,
  p_job_id bigint,
  p_now_time time without time zone,
  p_window_end time without time zone,
  p_safety_buffer integer,
  p_travel_buffer integer
)
returns public.st_jobs
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job public.st_jobs%rowtype;
  v_cleaner public.st_cleaners%rowtype;
  v_availability public.st_cleaner_availability%rowtype;
  v_active_jobs integer;
  v_start time without time zone;
  v_finish time without time zone;
begin
  perform pg_advisory_xact_lock(p_cleaner_id);

  select *
    into v_job
    from public.st_jobs
   where id = p_job_id
   for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Job not found';
  end if;

  if not v_job.marketplace_visible
     or v_job.assigned_cleaner_id is not null
     or v_job.status not in ('UNASSIGNED', 'AT_RISK', 'RESCUE') then
    raise exception using errcode = 'P0001', message = 'This job was already accepted by another cleaner';
  end if;

  select *
    into v_cleaner
    from public.st_cleaners
   where id = p_cleaner_id
     and active
   for share;

  if not found then
    raise exception using errcode = 'P0001', message = 'Cleaner is not active';
  end if;

  select *
    into v_availability
    from public.st_cleaner_availability
   where cleaner_id = p_cleaner_id
     and service_date = v_job.service_date;

  if not found or not coalesce(v_availability.online, false) then
    raise exception using errcode = 'P0001', message = 'Cleaner is offline';
  end if;

  v_start := coalesce(v_job.planned_start, v_job.earliest_start);
  v_finish := v_start + make_interval(
    mins => greatest(0, v_job.duration_minutes) + greatest(0, p_safety_buffer)
  );

  if v_start < p_now_time then
    raise exception using errcode = 'P0001', message = 'Job start has already passed';
  end if;

  if v_start < v_availability.from_time
     or v_finish > least(v_availability.to_time, p_window_end) then
    raise exception using errcode = 'P0001', message = 'Outside cleaner availability';
  end if;

  select count(*)
    into v_active_jobs
    from public.st_jobs j
   where j.assigned_cleaner_id = p_cleaner_id
     and j.service_date = v_job.service_date
     and j.status <> 'CANCELLED';

  if v_active_jobs >= v_cleaner.max_jobs_day then
    raise exception using errcode = 'P0001', message = 'Daily limit reached';
  end if;

  if exists (
    select 1
      from public.st_jobs j
     where j.assigned_cleaner_id = p_cleaner_id
       and j.service_date = v_job.service_date
       and j.status <> 'CANCELLED'
       and v_start < coalesce(j.planned_start, j.earliest_start)
           + make_interval(mins => greatest(0, j.duration_minutes) + greatest(0, p_safety_buffer) + greatest(0, p_travel_buffer))
       and v_finish + make_interval(mins => greatest(0, p_travel_buffer))
           > coalesce(j.planned_start, j.earliest_start)
  ) then
    raise exception using errcode = 'P0001', message = 'Conflicts with an assigned job';
  end if;

  update public.st_jobs
     set assigned_cleaner_id = p_cleaner_id,
         status = 'ACCEPTED',
         accepted_at = now(),
         marketplace_visible = false,
         rescue_state = 'NONE'
   where id = p_job_id
   returning * into v_job;

  return v_job;
end;
$$;

revoke all on function public.st_claim_marketplace_job(bigint, bigint, time, time, integer, integer) from public, anon, authenticated;
grant execute on function public.st_claim_marketplace_job(bigint, bigint, time, time, integer, integer) to service_role;
