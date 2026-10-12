-- Stage 1 (2026-10-12): bookings by window, marketplace-first dispatch, escalation,
-- expiry, GPS radius, cancellation rules, property-manager statements.
-- Owner decisions: marketplace first, manager after 24 h, rescue at 3 h; client picks a
-- window; free client cancellation until the cleaner arrives.
-- The 15-minute schedule for st_dispatch_tick() is enabled separately by the owner
-- (deployment/stage1-schedule.sql).

alter table public.st_jobs drop constraint if exists st_jobs_status_check;
alter table public.st_jobs add constraint st_jobs_status_check check (status in ('UNASSIGNED','OFFERED','ACCEPTED','EN_ROUTE','ARRIVED','CLEANING','COMPLETED','AT_RISK','RESCUE','CANCELLED','EXPIRED'));
-- A cancelled or expired booking must not block rebooking the same property and day.
alter table public.st_jobs drop constraint if exists st_jobs_object_id_service_date_key;
create unique index if not exists st_jobs_one_active_per_object_day on public.st_jobs(object_id,service_date) where status not in ('CANCELLED','EXPIRED');
alter table public.st_jobs add column if not exists client_note text check (client_note is null or length(client_note)<=1000);
alter table public.st_jobs add column if not exists checkin_distance_m integer;
alter table public.st_jobs add column if not exists escalated_at timestamptz;
alter table public.st_jobs add column if not exists expired_at timestamptz;

insert into public.st_settings(setting_key,value_json) values
 ('cleanerCancellationCutoffMinutes','180'),('rescueBonus','6'),('managerEscalationHours','24'),('rescueHours','3')
on conflict (setting_key) do nothing;

create or replace function public.st_notify_staff(p_type text,p_title text,p_message text) returns void
language sql security definer set search_path=public,pg_temp as $$
 insert into public.st_notifications(user_id,type,title,message)
 select id,p_type,p_title,p_message from public.st_users where active and role in ('ADMIN','OPERATIONS_MANAGER');
$$;
revoke all on function public.st_notify_staff(text,text,text) from public,anon,authenticated;
grant execute on function public.st_notify_staff(text,text,text) to service_role;

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
 if exists(select 1 from st_jobs where object_id=o.id and service_date=d and status not in ('CANCELLED','EXPIRED')) then raise exception 'A cleaning is already booked for this property and date';end if;
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
      if exists(select 1 from public.st_jobs j where j.assigned_cleaner_id=v_target_cleaner_id and j.service_date=v_job.service_date and j.status not in ('CANCELLED','EXPIRED') and j.id<>v_job.id
        and v_start < coalesce(j.planned_start,j.earliest_start)+make_interval(mins=>j.duration_minutes+v_safety+v_travel)
        and v_start+make_interval(mins=>v_job.duration_minutes+v_safety+v_travel)>coalesce(j.planned_start,j.earliest_start)) then raise exception 'Conflicts with another of your jobs that day'; end if;
    else
      v_start:=null;
      for v_candidate in select (v_window_from + make_interval(mins=>15*g))::time from generate_series(0,floor(extract(epoch from (v_window_to-v_window_from))/900)::int) g loop
        if not exists(select 1 from public.st_jobs j where j.assigned_cleaner_id=v_target_cleaner_id and j.service_date=v_job.service_date and j.status not in ('CANCELLED','EXPIRED') and j.id<>v_job.id
          and v_candidate < coalesce(j.planned_start,j.earliest_start)+make_interval(mins=>j.duration_minutes+v_safety+v_travel)
          and v_candidate+make_interval(mins=>v_job.duration_minutes+v_safety+v_travel)>coalesce(j.planned_start,j.earliest_start)) then v_start:=v_candidate; exit; end if;
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
      if exists(select 1 from st_jobs j where j.id<>v_job.id and j.assigned_cleaner_id=v_job.assigned_cleaner_id and j.service_date=v_job.service_date and j.status<>'CANCELLED'
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

create or replace function public.st_dispatch_tick() returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare n_exp int:=0;n_esc int:=0;n_res int:=0;nowl timestamp:=now() at time zone 'Europe/Bratislava';
 esc_h int:=coalesce((select value_json::text::int from st_settings where setting_key='managerEscalationHours'),24);
 res_h int:=coalesce((select value_json::text::int from st_settings where setting_key='rescueHours'),3);
 rbonus numeric:=coalesce((select value_json::text::numeric from st_settings where setting_key='rescueBonus'),6);
 r record;
begin
 for r in select j.id,o.code from st_jobs j join st_objects o on o.id=j.object_id
   where j.status in ('UNASSIGNED','OFFERED','AT_RISK','RESCUE') and j.service_date+j.deadline<nowl for update of j skip locked loop
   update st_jobs set status='EXPIRED',marketplace_visible=false,expired_at=now() where id=r.id;
   insert into st_job_events(job_id,event_type,payload_json) values(r.id,'EXPIRED','{}'::jsonb);
   perform st_notify_staff('EXPIRED','Cleaning expired without a cleaner',r.code||' · #'||r.id);n_exp:=n_exp+1;
 end loop;
 for r in select j.id,o.code from st_jobs j join st_objects o on o.id=j.object_id
   where j.status='UNASSIGNED' and j.assigned_cleaner_id is null and j.rescue_state='NONE' and j.service_date+j.earliest_start<=nowl+make_interval(hours=>res_h) for update of j skip locked loop
   update st_jobs set status='RESCUE',rescue_state='ACTIVE',marketplace_visible=true,bonus=greatest(bonus,rbonus) where id=r.id;
   insert into st_job_events(job_id,event_type,payload_json) values(r.id,'RESCUE_OPENED',jsonb_build_object('automatic',true));
   perform st_notify_staff('RESCUE','Rescue opened automatically',r.code||' · #'||r.id);
   insert into st_notifications(user_id,type,title,message) select cl.user_id,'RESCUE','Urgent cleaning with bonus',r.code from st_cleaners cl join st_users cu on cu.id=cl.user_id and cu.active where cl.active;
   n_res:=n_res+1;
 end loop;
 for r in select j.id,o.code from st_jobs j join st_objects o on o.id=j.object_id
   where j.status='UNASSIGNED' and j.assigned_cleaner_id is null and j.escalated_at is null and j.service_date+j.earliest_start<=nowl+make_interval(hours=>esc_h) for update of j skip locked loop
   update st_jobs set escalated_at=now() where id=r.id;
   perform st_notify_staff('ESCALATION','No cleaner yet — assign manually',r.code||' · #'||r.id);n_esc:=n_esc+1;
 end loop;
 return jsonb_build_object('expired',n_exp,'escalated',n_esc,'rescue',n_res);
end $$;
revoke all on function public.st_dispatch_tick() from public,anon,authenticated;
grant execute on function public.st_dispatch_tick() to service_role;

create or replace function public.st_settlement_report(p_actor_id bigint,p_month text,p_before bigint default null,p_limit integer default 100) returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare u st_users%rowtype;start_date date;finish_date date;answer jsonb;
begin
 select * into strict u from st_users where id=p_actor_id and active;
 if u.role not in ('ADMIN','OWNER','PROPERTY_MANAGER','CLEANER') then raise exception 'Forbidden';end if;
 if p_month !~ '^\d{4}-(0[1-9]|1[0-2])$' then raise exception 'Invalid month';end if;
 if p_limit is null or p_limit<1 or p_limit>500 then raise exception 'Invalid page size';end if;
 start_date:=(p_month||'-01')::date;finish_date:=(start_date+interval '1 month')::date;
 with eligible as (
  select j.*,o.code,o.name from st_jobs j join st_objects o on o.id=j.object_id
  where j.status='COMPLETED' and j.service_date>=start_date and j.service_date<finish_date
  and (u.role='ADMIN' or (u.role='OWNER' and j.client_id in(select id from st_client_accounts where user_id=u.id))
   or (u.role='PROPERTY_MANAGER' and j.object_id in(select mp.object_id from st_manager_properties mp join st_client_accounts ca on ca.id=mp.manager_client_id where ca.user_id=u.id))
   or (u.role='CLEANER' and j.assigned_cleaner_id in(select id from st_cleaners where user_id=u.id and active)))
 ), amounts as (
  select j.id,j.service_date,j.code,j.name,j.review_status,round((j.client_price+j.extra_revenue)*100)::bigint charged,
    round((j.payout+j.bonus)*100)::bigint earned,
    coalesce((select sum(case kind when 'CLIENT_PAYMENT' then amount_cents when 'CLIENT_REFUND' then -amount_cents else 0 end) from st_settlements where job_id=j.id),0)::bigint received,
    coalesce((select sum(case kind when 'CLEANER_PAYOUT' then amount_cents when 'CLEANER_RETURN' then -amount_cents else 0 end) from st_settlements where job_id=j.id),0)::bigint paid
  from eligible j
 ), rows as (
  select id, jsonb_build_object('id',id,'service_date',service_date,'object_code',code,'object_name',name,'review_status',review_status)
    ||case when u.role in ('ADMIN','OWNER','PROPERTY_MANAGER') then jsonb_build_object('chargedCents',charged,'receivedCents',received,'dueCents',charged-received) else '{}'::jsonb end
    ||case when u.role in ('ADMIN','CLEANER') then jsonb_build_object('earnedCents',earned,'paidCents',paid,'payableCents',case when review_status='APPROVED' then earned-paid else 0 end,'waitingReviewCents',case when review_status<>'APPROVED' then earned-paid else 0 end) else '{}'::jsonb end as row from amounts
 ) select jsonb_build_object('month',p_month,'summary',
   jsonb_build_object('jobs',count(*))
   ||case when u.role in ('ADMIN','OWNER','PROPERTY_MANAGER') then jsonb_build_object('chargedCents',coalesce(sum(charged),0),'receivedCents',coalesce(sum(received),0),'dueCents',coalesce(sum(charged-received),0)) else '{}'::jsonb end
   ||case when u.role in ('ADMIN','CLEANER') then jsonb_build_object('earnedCents',coalesce(sum(earned),0),'paidCents',coalesce(sum(paid),0),'payableCents',coalesce(sum(case when review_status='APPROVED' then earned-paid else 0 end),0),'waitingReviewCents',coalesce(sum(case when review_status<>'APPROVED' then earned-paid else 0 end),0)) else '{}'::jsonb end,
   'jobs',coalesce((select jsonb_agg(row order by id desc) from (select * from rows where p_before is null or id<p_before order by id desc limit p_limit) s),'[]'::jsonb),
   'hasMore',(select count(*)>p_limit from rows where p_before is null or id<p_before),
   'nextCursor',(select min(id) from (select id from rows where p_before is null or id<p_before order by id desc limit p_limit) page)) into answer from amounts;
 return answer;
end $$;

revoke all on function public.st_settlement_report(bigint,text,bigint,integer) from public,anon,authenticated;
grant execute on function public.st_settlement_report(bigint,text,bigint,integer) to service_role;

alter function public.st_validate_job_command_request_id() set search_path=public,pg_temp;
