-- A cleaning that is finished no longer blocks the cleaner's day (owner report 2026-11-23).
-- A cleaner who finished early could not take the next cleaning: overlap checks counted COMPLETED
-- cleanings at their planned window. Now only cleanings still in progress or ahead (ACCEPTED,
-- EN_ROUTE, ARRIVED, CLEANING) occupy time, and a cleaning already started is placed at its actual
-- start. The daily limit still counts every cleaning of the day, finished ones included.

create or replace function public.st_job_command(
  p_actor_id bigint,
  p_job_id bigint,
  p_action text,
  p_body jsonb default '{}'::jsonb,
  p_request_id text default null
) returns public.st_jobs
language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_actor public.st_users%rowtype;
  v_job public.st_jobs%rowtype;
  v_existing public.st_job_command_requests%rowtype;
  v_cleaner public.st_cleaners%rowtype;
  v_target_cleaner_id bigint;
  v_event text;
  v_start time;
  v_deadline time;
  v_duration integer;
  v_now time;
  v_safety integer := greatest(0,coalesce((p_body->>'safetyBuffer')::integer,10));
  v_travel integer := greatest(0,coalesce((p_body->>'travelBuffer')::integer,15));
  v_obj public.st_objects%rowtype;
  v_dist double precision;
  v_radius integer;
  v_minutes_left integer;
  v_late boolean := false;
  v_window_from time;
  v_window_to time;
  v_candidate time;
begin
  if p_request_id is null or btrim(p_request_id)='' then
    p_request_id := gen_random_uuid()::text;
  end if;
  if length(p_request_id)>200 then raise exception 'Request id is too long'; end if;
  p_action := lower(btrim(coalesce(p_action,'')));

  select * into v_actor from public.st_users where id=p_actor_id and active;
  if not found then raise exception 'Actor is not active'; end if;

  -- Serialize retries of the same logical command before reading its result.
  perform pg_advisory_xact_lock(hashtext(p_actor_id::text||':'||p_request_id));
  select * into v_existing from public.st_job_command_requests where actor_id=p_actor_id and request_id=p_request_id;
  if found then
    if v_existing.job_id<>p_job_id or v_existing.action<>p_action then raise exception 'Request id was already used for another command'; end if;
    if v_existing.action='accept' then
      if v_actor.role<>'CLEANER' or not exists(select 1 from public.st_cleaners where user_id=v_actor.id and active) then raise exception 'Forbidden'; end if;
    elsif v_existing.action in ('status','complete') then
      if v_actor.role<>'CLEANER' or not exists(select 1 from public.st_cleaners where user_id=v_actor.id and active and id=(select assigned_cleaner_id from public.st_jobs where id=p_job_id)) then raise exception 'Forbidden'; end if;
    elsif v_existing.action='cancel' then
      if not (
        v_actor.role in ('ADMIN','OPERATIONS_MANAGER')
        or (v_actor.role='CLEANER' and exists(select 1 from public.st_cleaners where user_id=v_actor.id and active))
        or (v_actor.role='OWNER' and exists(select 1 from public.st_client_accounts c join public.st_jobs j on j.client_id=c.id where c.user_id=v_actor.id and j.id=p_job_id))
        or (v_actor.role='PROPERTY_MANAGER' and exists(select 1 from public.st_client_accounts c join public.st_manager_properties m on m.manager_client_id=c.id join public.st_jobs j on j.object_id=m.object_id where c.user_id=v_actor.id and j.id=p_job_id))
      ) then raise exception 'Forbidden'; end if;
    elsif v_actor.role not in ('ADMIN','OPERATIONS_MANAGER') then raise exception 'Forbidden';
    end if;
    select * into strict v_job from jsonb_populate_record(null::public.st_jobs,v_existing.response_json);
    return v_job;
  end if;

  -- Every command for a service day takes the same lock before its row lock.
  select service_date into strict v_job.service_date from public.st_jobs where id=p_job_id;
  perform pg_advisory_xact_lock(hashtext(v_job.service_date::text));
  select * into strict v_job from public.st_jobs where id=p_job_id for update;

  if v_job.review_status='REWORK_REQUIRED' and p_action<>'complete' then raise exception 'Rework must be completed by the assigned cleaner'; end if;

  if p_action='accept' then
    if v_actor.role<>'CLEANER' then raise exception 'Only a cleaner can accept a job'; end if;
    select * into v_cleaner from public.st_cleaners where user_id=v_actor.id and active for update;
    if not found then raise exception 'Cleaner is not active'; end if;
    v_target_cleaner_id:=v_cleaner.id;
    if v_job.assigned_cleaner_id is not null or not v_job.marketplace_visible or v_job.status not in ('UNASSIGNED','AT_RISK','RESCUE') then raise exception 'Job is not available or was already accepted'; end if;
  elsif p_action='assign' then
    if v_actor.role not in ('ADMIN','OPERATIONS_MANAGER') then raise exception 'Forbidden'; end if;
    v_target_cleaner_id:=nullif(p_body->>'cleanerId','')::bigint;
    select * into v_cleaner from public.st_cleaners where id=v_target_cleaner_id and active for update;
    if not found then raise exception 'Cleaner is not active'; end if;
    if v_job.status in ('COMPLETED','CANCELLED','EXPIRED') then raise exception 'Terminal jobs cannot be assigned'; end if;
  elsif p_action in ('status','complete') then
    if v_actor.role<>'CLEANER' then raise exception 'Forbidden'; end if;
    select * into v_cleaner from public.st_cleaners where user_id=v_actor.id and active;
    if not found or v_job.assigned_cleaner_id is distinct from v_cleaner.id then raise exception 'This job is not assigned to you'; end if;
  elsif p_action='cancel' then
    if v_actor.role='CLEANER' then
      select * into v_cleaner from public.st_cleaners where user_id=v_actor.id and active;
      if not found or v_job.assigned_cleaner_id is distinct from v_cleaner.id then raise exception 'This job is not assigned to you'; end if;
    elsif v_actor.role='OWNER' then
      if not exists(select 1 from public.st_client_accounts c where c.user_id=v_actor.id and c.id=v_job.client_id) then raise exception 'Forbidden'; end if;
    elsif v_actor.role='PROPERTY_MANAGER' then
      if not exists(select 1 from public.st_client_accounts c join public.st_manager_properties m on m.manager_client_id=c.id where c.user_id=v_actor.id and m.object_id=v_job.object_id) then raise exception 'Forbidden'; end if;
    elsif v_actor.role not in ('ADMIN','OPERATIONS_MANAGER') then raise exception 'Forbidden'; end if;
  elsif p_action in ('rescue','patch') then
    if v_actor.role not in ('ADMIN','OPERATIONS_MANAGER') then raise exception 'Forbidden'; end if;
  else raise exception 'Unsupported job command';
  end if;

  if exists(select 1 from jsonb_each_text(p_body) v where v.key in ('payout','clientPrice','bonus','extraRevenue','extraCost') and v.value::numeric<0) then raise exception 'Negative amount is not allowed'; end if;
  if v_actor.role='OPERATIONS_MANAGER' and p_action='patch' and p_body ?| array['payout','clientPrice','extraRevenue','extraCost','financialStatus'] then raise exception 'Forbidden: finance requires administrator'; end if;

  if p_action in ('accept','assign') then
    if v_job.service_date < (now() at time zone 'Europe/Bratislava')::date then raise exception 'Job date has already passed'; end if;
    v_now:=case when v_job.service_date=(now() at time zone 'Europe/Bratislava')::date then (now() at time zone 'Europe/Bratislava')::time else '00:00'::time end;
    -- The cleaner (or manager) picks a start inside the client's window. Without an explicit
    -- choice the server takes the first free 15-minute start, exactly like the marketplace shows.
    v_window_from:=greatest(v_job.earliest_start,case when v_now='00:00'::time then v_job.earliest_start else (date_trunc('minute',now() at time zone 'Europe/Bratislava')+interval '15 minutes')::time end);
    v_window_to:=(v_job.deadline - make_interval(mins=>v_job.duration_minutes))::time;
    if v_window_from>v_window_to then raise exception 'Not enough time left before the deadline'; end if;
    if (select count(*) from public.st_jobs j where j.assigned_cleaner_id=v_target_cleaner_id and j.service_date=v_job.service_date and j.status not in ('CANCELLED','EXPIRED') and j.id<>v_job.id)>=v_cleaner.max_jobs_day then raise exception 'Daily limit reached'; end if;
    if nullif(p_body->>'plannedStart','') is not null then
      v_start:=(p_body->>'plannedStart')::time;
      if v_start<v_job.earliest_start then raise exception 'Start is before the cleaning window'; end if;
      if v_start<v_now then raise exception 'Start time has already passed'; end if;
      if v_start>v_window_to then raise exception 'Not enough time left before the deadline'; end if;
      if exists(select 1 from public.st_jobs j where j.assigned_cleaner_id=v_target_cleaner_id and j.service_date=v_job.service_date and j.status in ('ACCEPTED','EN_ROUTE','ARRIVED','CLEANING') and j.id<>v_job.id
        and v_start < coalesce((j.actual_start at time zone 'Europe/Bratislava')::time,j.planned_start,j.earliest_start)+make_interval(mins=>j.duration_minutes+v_safety+v_travel)
        and v_start+make_interval(mins=>v_job.duration_minutes+v_safety+v_travel)>coalesce((j.actual_start at time zone 'Europe/Bratislava')::time,j.planned_start,j.earliest_start)) then raise exception 'Conflicts with another of your jobs that day'; end if;
    else
      v_start:=null;
      for v_candidate in select (v_window_from + make_interval(mins=>15*g))::time from generate_series(0,floor(extract(epoch from (v_window_to-v_window_from))/900)::int) g loop
        if not exists(select 1 from public.st_jobs j where j.assigned_cleaner_id=v_target_cleaner_id and j.service_date=v_job.service_date and j.status in ('ACCEPTED','EN_ROUTE','ARRIVED','CLEANING') and j.id<>v_job.id
          and v_candidate < coalesce((j.actual_start at time zone 'Europe/Bratislava')::time,j.planned_start,j.earliest_start)+make_interval(mins=>j.duration_minutes+v_safety+v_travel)
          and v_candidate+make_interval(mins=>v_job.duration_minutes+v_safety+v_travel)>coalesce((j.actual_start at time zone 'Europe/Bratislava')::time,j.planned_start,j.earliest_start)) then v_start:=v_candidate; exit; end if;
      end loop;
      if v_start is null then raise exception 'Conflicts with another of your jobs that day'; end if;
    end if;
    update public.st_jobs set assigned_cleaner_id=v_target_cleaner_id,status='ACCEPTED',marketplace_visible=false,rescue_state=case when v_job.rescue_state='ACTIVE' then 'ASSIGNED' else 'NONE' end,accepted_at=now(),planned_start=v_start,eta=v_start+make_interval(mins=>v_job.duration_minutes),
      bonus=case when p_action='assign' then coalesce((p_body->>'bonus')::numeric,bonus) else bonus end
      where id=p_job_id returning * into v_job;
    v_event:=case when p_action='accept' then 'CLEANER_ACCEPTED' else 'ADMIN_ASSIGNED' end;
  elsif p_action='status' then
    if not ((v_job.status='ACCEPTED' and p_body->>'status'='EN_ROUTE') or (v_job.status='EN_ROUTE' and p_body->>'status'='ARRIVED') or (v_job.status='ARRIVED' and p_body->>'status'='CLEANING')) then raise exception 'This status transition is not allowed'; end if;
    update public.st_jobs set status=p_body->>'status', actual_checkin=case when p_body->>'status'='ARRIVED' then now() else actual_checkin end, actual_start=case when p_body->>'status'='CLEANING' then now() else actual_start end, checkin_lat=case when p_body->>'status'='ARRIVED' then nullif(p_body->>'lat','')::double precision else checkin_lat end, checkin_lng=case when p_body->>'status'='ARRIVED' then nullif(p_body->>'lng','')::double precision else checkin_lng end where id=p_job_id returning * into v_job;
    v_event:='STATUS_'||(p_body->>'status');
    if p_body->>'status'='ARRIVED' then
      select * into v_obj from public.st_objects where id=v_job.object_id;
      v_radius:=greatest(25,coalesce((select value_json::text::integer from public.st_settings where setting_key='checkinRadiusMeters'),250));
      if v_job.checkin_lat is not null and v_obj.lat is not null then
        v_dist:=2*6371000*asin(sqrt(power(sin(radians(v_job.checkin_lat-v_obj.lat)/2),2)+cos(radians(v_obj.lat))*cos(radians(v_job.checkin_lat))*power(sin(radians(v_job.checkin_lng-v_obj.lng)/2),2)));
      end if;
      update public.st_jobs set checkin_distance_m=round(v_dist)::integer where id=p_job_id returning * into v_job;
      if v_obj.lat is not null and (v_dist is null or v_dist>v_radius) then
        insert into public.st_job_events(job_id,user_id,event_type,payload_json) values(p_job_id,p_actor_id,'CHECKIN_OUTSIDE_RADIUS',jsonb_build_object('distanceM',round(v_dist),'radiusM',v_radius,'reason',coalesce(p_body->>'reason','')));
        perform public.st_notify_staff('CHECKIN','Check-in outside the property',v_obj.code||': '||coalesce(round(v_dist)::text||' m','no location'));
      end if;
    end if;
  elsif p_action='complete' then
    if v_job.status<>'CLEANING' then raise exception 'Start cleaning before completing the job'; end if;
    if exists(select 1 from public.st_job_checklist c where c.job_id=p_job_id and c.required and not c.completed) then raise exception 'Checklist is incomplete'; end if;
    if exists(select 1 from public.st_job_checklist c where c.job_id=p_job_id and c.photo_required and not exists(select 1 from public.st_job_photos p where p.job_id=p_job_id and p.category=c.photo_category and p.mime in ('image/jpeg','image/png','image/webp'))) then raise exception 'Checklist photo is incomplete'; end if;
    if not v_job.completion_counted then
      update public.st_cleaners set completed_jobs=completed_jobs+1 where id=v_job.assigned_cleaner_id;
    end if;
    update public.st_jobs set status='COMPLETED',completed_at=coalesce(completed_at,now()),marketplace_visible=false,
      completion_counted=true,review_status='PENDING',review_version=review_version+1,review_note=null,reviewed_at=null,reviewed_by_user_id=null
      where id=p_job_id returning * into v_job;
    v_event:='COMPLETED';
  elsif p_action='cancel' then
    if v_job.status in ('COMPLETED','CANCELLED','EXPIRED') then raise exception 'Terminal job cannot be cancelled'; end if;
    if v_actor.role='CLEANER' then
      if v_job.status not in ('ACCEPTED','EN_ROUTE') then raise exception 'After arrival the job can only be released by Operations'; end if;
      v_minutes_left:=extract(epoch from ((v_job.service_date+coalesce(v_job.planned_start,v_job.earliest_start)) - (now() at time zone 'Europe/Bratislava')))/60;
      v_late:=v_minutes_left < greatest(0,coalesce((select value_json::text::integer from public.st_settings where setting_key='cleanerCancellationCutoffMinutes'),180));
      update public.st_jobs set assigned_cleaner_id=null,planned_start=null,eta=null,
        status=case when v_late then 'RESCUE' else 'UNASSIGNED' end,marketplace_visible=true,
        rescue_state=case when v_late then 'ACTIVE' else 'NONE' end,
        bonus=case when v_late then greatest(bonus,coalesce((select value_json::text::numeric from public.st_settings where setting_key='rescueBonus'),6)) else bonus end,
        cancellation_reason=coalesce(nullif(p_body->>'reason',''),'Cleaner cancelled') where id=p_job_id returning * into v_job;
      if v_late then
        update public.st_cleaners set reliability_score=greatest(0,reliability_score-5) where id=v_cleaner.id;
        perform public.st_notify_staff('RESCUE','Late release: rescue opened','Job #'||v_job.id);
      end if;
      v_event:=case when v_late then 'CLEANER_CANCELLED_LATE' else 'CLEANER_CANCELLED' end;
    else
      if v_actor.role in ('OWNER','PROPERTY_MANAGER') and v_job.status in ('ARRIVED','CLEANING') then raise exception 'The cleaner is already on site. Contact Operations to cancel'; end if;
      update public.st_jobs set status='CANCELLED',marketplace_visible=false,cancellation_reason=coalesce(p_body->>'reason','') where id=p_job_id returning * into v_job;
      v_event:=case when v_actor.role in ('OWNER','PROPERTY_MANAGER') then 'CLIENT_CANCELLED' else 'ADMIN_CANCELLED' end;
      if v_actor.role in ('OWNER','PROPERTY_MANAGER') then perform public.st_notify_staff('CLIENT_CANCELLED','Client cancelled a cleaning','Job #'||v_job.id); end if;
    end if;
  elsif p_action='rescue' then
    if v_job.status in ('COMPLETED','CANCELLED','EXPIRED') then raise exception 'Terminal jobs cannot enter rescue'; end if;
    update public.st_jobs set status='RESCUE',bonus=greatest(0,coalesce((p_body->>'bonus')::numeric,bonus,6)),marketplace_visible=true,rescue_state='ACTIVE',assigned_cleaner_id=null where id=p_job_id returning * into v_job;
    v_event:='RESCUE_OPENED';
  elsif p_action='patch' then
    if v_job.status in ('COMPLETED','CANCELLED','EXPIRED') then raise exception 'Terminal jobs cannot be changed'; end if;
    if p_body ? 'status' then raise exception 'Status requires a dedicated command'; end if;
    v_start:=coalesce(nullif(p_body->>'earliestStart','')::time,v_job.earliest_start);
    v_deadline:=coalesce(nullif(p_body->>'deadline','')::time,v_job.deadline);
    v_duration:=coalesce((p_body->>'durationMinutes')::integer,v_job.duration_minutes);
    if v_start>=v_deadline or v_duration<15 or v_job.service_date+v_start+make_interval(mins=>v_duration)>v_job.service_date+v_deadline then raise exception 'Invalid service window'; end if;
    update public.st_jobs set payout=coalesce((p_body->>'payout')::numeric,payout),client_price=coalesce((p_body->>'clientPrice')::numeric,client_price),bonus=coalesce((p_body->>'bonus')::numeric,bonus),extra_revenue=coalesce((p_body->>'extraRevenue')::numeric,extra_revenue),extra_cost=coalesce((p_body->>'extraCost')::numeric,extra_cost),financial_status=coalesce(p_body->>'financialStatus',financial_status),earliest_start=v_start,deadline=v_deadline,duration_minutes=v_duration,marketplace_visible=coalesce((p_body->>'marketplaceVisible')::boolean,marketplace_visible) where id=p_job_id returning * into v_job;
    if v_job.assigned_cleaner_id is not null and p_body ?| array['earliestStart','deadline','durationMinutes'] then
      if coalesce(v_job.planned_start,v_start)<v_start or v_job.service_date+coalesce(v_job.planned_start,v_start)+make_interval(mins=>v_duration+v_safety)>v_job.service_date+v_deadline then raise exception 'Invalid assigned service window'; end if;
      if exists(select 1 from st_jobs j where j.id<>v_job.id and j.assigned_cleaner_id=v_job.assigned_cleaner_id and j.service_date=v_job.service_date and j.status in ('ACCEPTED','EN_ROUTE','ARRIVED','CLEANING')
        and v_job.service_date+coalesce(v_job.planned_start,v_start)<j.service_date+coalesce(j.planned_start,j.earliest_start)+make_interval(mins=>j.duration_minutes+v_safety+v_travel)
        and v_job.service_date+coalesce(v_job.planned_start,v_start)+make_interval(mins=>v_duration+v_safety+v_travel)>j.service_date+coalesce(j.planned_start,j.earliest_start)) then raise exception 'Conflicts with assigned job'; end if;
    end if;
    v_event:='JOB_UPDATED';
  end if;

  if p_action='assign' then insert into st_notifications(user_id,type,title,message) values(v_cleaner.user_id,'ASSIGNED','New job assigned','Cleaning #'||v_job.id||' was assigned by Operations'); end if;
  insert into public.st_job_events(job_id,user_id,event_type,payload_json) values(p_job_id,p_actor_id,v_event,p_body);
  insert into public.st_job_command_requests(actor_id,request_id,job_id,action,response_json) values(p_actor_id,p_request_id,p_job_id,p_action,to_jsonb(v_job));
  return v_job;
exception when unique_violation then
  select * into v_existing from public.st_job_command_requests where actor_id=p_actor_id and request_id=p_request_id;
  if found and v_existing.job_id=p_job_id and v_existing.action=p_action then select * into strict v_job from jsonb_populate_record(null::public.st_jobs,v_existing.response_json); return v_job; end if;
  raise;
end $$;
revoke all on function public.st_job_command(bigint,bigint,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.st_job_command(bigint,bigint,text,jsonb,text) to service_role;
