-- Historical completed jobs retain their approved economics and evidence.
alter table public.st_jobs
 add column review_status text not null default 'NOT_SUBMITTED' check(review_status in ('NOT_SUBMITTED','PENDING','APPROVED','REWORK_REQUIRED')),
 add column review_version integer not null default 0 check(review_version>=0),
 add column review_note text,
 add column reviewed_at timestamptz,
 add column reviewed_by_user_id bigint references public.st_users(id),
 add column completion_counted boolean not null default false;
update public.st_jobs set review_status='APPROVED',completion_counted=true where status='COMPLETED';
create index st_jobs_review_queue_idx on public.st_jobs(service_date,id) where review_status='PENDING';

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
    if v_job.status in ('COMPLETED','CANCELLED') then raise exception 'Terminal jobs cannot be assigned'; end if;
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
    v_start:=coalesce(v_job.planned_start,v_job.earliest_start);
    if v_job.service_date < (now() at time zone 'Europe/Bratislava')::date then raise exception 'Job date has already passed'; end if;
    v_now:=case when v_job.service_date=(now() at time zone 'Europe/Bratislava')::date then (now() at time zone 'Europe/Bratislava')::time else '00:00'::time end;
    if v_start<v_job.earliest_start then raise exception 'Outside object window'; end if;
    if v_start<v_now then raise exception 'Job start has already passed'; end if;
    if not exists(select 1 from public.st_cleaner_availability a where a.cleaner_id=v_target_cleaner_id and a.service_date=v_job.service_date and a.online and v_start>=a.from_time and v_job.service_date+v_start+make_interval(mins=>v_job.duration_minutes+v_safety)<=v_job.service_date+a.to_time) then raise exception 'Outside cleaner availability'; end if;
    if v_job.service_date+v_start+make_interval(mins=>v_job.duration_minutes+v_safety)>v_job.service_date+v_job.deadline then raise exception 'Outside object window'; end if;
    if (select count(*) from public.st_jobs j where j.assigned_cleaner_id=v_target_cleaner_id and j.service_date=v_job.service_date and j.status<>'CANCELLED' and j.id<>v_job.id)>=v_cleaner.max_jobs_day then raise exception 'Daily limit reached'; end if;
    if exists(select 1 from public.st_jobs j where j.assigned_cleaner_id=v_target_cleaner_id and j.service_date=v_job.service_date and j.status<>'CANCELLED' and j.id<>v_job.id
      and v_start < coalesce(j.planned_start,j.earliest_start)+make_interval(mins=>j.duration_minutes+v_safety+v_travel)
      and v_start+make_interval(mins=>v_job.duration_minutes+v_safety+v_travel)>coalesce(j.planned_start,j.earliest_start)) then raise exception 'Conflicts with an assigned job'; end if;
    update public.st_jobs set assigned_cleaner_id=v_target_cleaner_id,status='ACCEPTED',marketplace_visible=false,rescue_state='NONE',accepted_at=now(),
      bonus=case when p_action='assign' then coalesce((p_body->>'bonus')::numeric,bonus) else bonus end
      where id=p_job_id returning * into v_job;
    v_event:=case when p_action='accept' then 'CLEANER_ACCEPTED' else 'ADMIN_ASSIGNED' end;
  elsif p_action='status' then
    if not ((v_job.status='ACCEPTED' and p_body->>'status'='EN_ROUTE') or (v_job.status='EN_ROUTE' and p_body->>'status'='ARRIVED') or (v_job.status='ARRIVED' and p_body->>'status'='CLEANING')) then raise exception 'This status transition is not allowed'; end if;
    update public.st_jobs set status=p_body->>'status', actual_checkin=case when p_body->>'status'='ARRIVED' then now() else actual_checkin end, actual_start=case when p_body->>'status'='CLEANING' then now() else actual_start end, checkin_lat=case when p_body->>'status'='ARRIVED' then nullif(p_body->>'lat','')::double precision else checkin_lat end, checkin_lng=case when p_body->>'status'='ARRIVED' then nullif(p_body->>'lng','')::double precision else checkin_lng end where id=p_job_id returning * into v_job;
    v_event:='STATUS_'||(p_body->>'status');
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
    if v_job.status in ('COMPLETED','CANCELLED') then raise exception 'Terminal job cannot be cancelled'; end if;
    if v_actor.role='CLEANER' then
      update public.st_jobs set assigned_cleaner_id=null,status='UNASSIGNED',marketplace_visible=true,rescue_state='NONE',cancellation_reason=coalesce(nullif(p_body->>'reason',''),'Cleaner cancelled') where id=p_job_id returning * into v_job;
      v_event:='CLEANER_CANCELLED';
    else
      update public.st_jobs set status='CANCELLED',marketplace_visible=false,cancellation_reason=coalesce(p_body->>'reason','') where id=p_job_id returning * into v_job;
      v_event:=case when v_actor.role in ('OWNER','PROPERTY_MANAGER') then 'CLIENT_CANCELLED' else 'ADMIN_CANCELLED' end;
    end if;
  elsif p_action='rescue' then
    if v_job.status in ('COMPLETED','CANCELLED') then raise exception 'Terminal jobs cannot enter rescue'; end if;
    update public.st_jobs set status='RESCUE',bonus=greatest(0,coalesce((p_body->>'bonus')::numeric,bonus,6)),marketplace_visible=true,rescue_state='ACTIVE',assigned_cleaner_id=null where id=p_job_id returning * into v_job;
    v_event:='RESCUE_OPENED';
  elsif p_action='patch' then
    if v_job.status in ('COMPLETED','CANCELLED') then raise exception 'Terminal jobs cannot be changed'; end if;
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


-- Service API resolves actor identity; browser roles cannot invoke this RPC.
create function public.st_review_job(p_actor_id bigint,p_job_id bigint,p_decision text,p_note text,p_request_id text,p_expected_version integer)
returns public.st_jobs language plpgsql security definer set search_path=public,pg_temp as $$
declare j public.st_jobs%rowtype;r public.st_job_command_requests%rowtype;payload jsonb;
begin
 if not exists(select 1 from public.st_users where id=p_actor_id and active and role in ('ADMIN','OPERATIONS_MANAGER')) then raise exception 'Forbidden';end if;
 if p_decision is null or p_decision not in ('APPROVED','REWORK_REQUIRED') then raise exception 'Invalid review decision';end if;
 if p_request_id is null or p_request_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,95}$' then raise exception 'Invalid request id';end if;
 if p_expected_version is null or p_expected_version<1 then raise exception 'Review version required';end if;
 p_note:=btrim(coalesce(p_note,''));
 if length(p_note)>2000 or (p_decision='REWORK_REQUIRED' and length(p_note)=0) then raise exception 'Rework note required (maximum 2000 characters)';end if;
 payload:=jsonb_build_object('decision',p_decision,'note',p_note,'expectedVersion',p_expected_version);
 perform pg_advisory_xact_lock(hashtext(p_actor_id::text||':'||p_request_id));
 select * into r from public.st_job_command_requests where actor_id=p_actor_id and request_id=p_request_id;
 if found then
  if r.job_id<>p_job_id or r.action<>'review' or r.response_json->'_review_request' is distinct from payload then raise exception 'Request id was already used for another command';end if;
  return jsonb_populate_record(null::public.st_jobs,r.response_json);
 end if;
 select service_date into strict j.service_date from public.st_jobs where id=p_job_id;
 perform pg_advisory_xact_lock(hashtext(j.service_date::text));
 select * into strict j from public.st_jobs where id=p_job_id for update;
 if j.review_version<>p_expected_version then raise exception 'Stale review version; refresh job';end if;
 if j.status<>'COMPLETED' or j.review_status<>'PENDING' then raise exception 'Only pending completed jobs can be reviewed';end if;
 if p_decision='REWORK_REQUIRED' then
  if exists(select 1 from public.st_settlements where job_id=j.id) or j.financial_status='PAID' then raise exception 'Settled jobs cannot be reopened';end if;
  if not exists(select 1 from public.st_cleaners c join public.st_users u on u.id=c.user_id where c.id=j.assigned_cleaner_id and c.active and u.active) then raise exception 'Assigned cleaner is not active';end if;
 end if;
 update public.st_jobs set review_status=p_decision,review_version=review_version+1,review_note=nullif(p_note,''),reviewed_at=now(),reviewed_by_user_id=p_actor_id,
 status=case when p_decision='REWORK_REQUIRED' then 'CLEANING' else status end,marketplace_visible=false where id=j.id returning * into j;
 -- Internal note is stored on the job, never in client-visible event payloads.
 insert into public.st_job_events(job_id,user_id,event_type,payload_json) values(j.id,p_actor_id,'QUALITY_'||p_decision,jsonb_build_object('reviewVersion',j.review_version));
 insert into public.st_job_command_requests(actor_id,request_id,job_id,action,response_json) values(p_actor_id,p_request_id,j.id,'review',to_jsonb(j)||jsonb_build_object('_review_request',payload));
 return j;
end $$;
revoke all on function public.st_review_job(bigint,bigint,text,text,text,integer) from public,anon,authenticated;
grant execute on function public.st_review_job(bigint,bigint,text,text,text,integer) to service_role;

create or replace function st_record_settlement(p_actor_id bigint,p_job_id bigint,p_kind text,p_amount_cents bigint,p_note text,p_request_id text) returns st_settlements
language plpgsql security definer set search_path=public,pg_temp as $$
declare j st_jobs%rowtype;r st_settlements%rowtype;total bigint;received bigint;paid bigint;
begin
 if not exists(select 1 from st_users where id=p_actor_id and active and role='ADMIN') then raise exception 'Forbidden';end if;
 if p_amount_cents<=0 or p_amount_cents>100000000 or p_amount_cents is null or length(btrim(coalesce(p_note,'')))=0 or length(coalesce(p_request_id,'')) not between 1 and 200 then raise exception 'Invalid settlement amount, note or request id';end if;
 perform pg_advisory_xact_lock(hashtext(p_actor_id::text||':'||p_request_id));
 select * into r from st_settlements where created_by_user_id=p_actor_id and request_id=p_request_id;
 if found then
   if r.job_id<>p_job_id or r.kind<>p_kind or r.amount_cents<>p_amount_cents then raise exception 'Request id already used';end if;return r;
 end if;
 select * into strict j from st_jobs where id=p_job_id for update;
 if j.review_status<>'APPROVED' then raise exception 'Only approved jobs can be settled';end if;
 if j.status<>'COMPLETED' then raise exception 'Only completed jobs can be settled';end if;
 select coalesce(sum(case kind when 'CLIENT_PAYMENT' then amount_cents when 'CLIENT_REFUND' then -amount_cents else 0 end),0),
   coalesce(sum(case kind when 'CLEANER_PAYOUT' then amount_cents when 'CLEANER_RETURN' then -amount_cents else 0 end),0)
   into received,paid from st_settlements where job_id=p_job_id;
 total:=case when p_kind='CLIENT_PAYMENT' then round((j.client_price+j.extra_revenue)*100)-received
 when p_kind='CLEANER_PAYOUT' then round((j.payout+j.bonus)*100)-paid when p_kind='CLIENT_REFUND' then received when p_kind='CLEANER_RETURN' then paid else null end;
 if total is null or p_amount_cents>total then raise exception 'Amount exceeds outstanding balance';end if;
 insert into st_settlements(job_id,kind,amount_cents,note,request_id,created_by_user_id) values(p_job_id,p_kind,p_amount_cents,p_note,p_request_id,p_actor_id) returning * into r;
 if p_kind in ('CLIENT_PAYMENT','CLIENT_REFUND') then
  update st_jobs set financial_status=case when received+case when p_kind='CLIENT_PAYMENT' then p_amount_cents else -p_amount_cents end>=round((client_price+extra_revenue)*100) then 'PAID' else 'INVOICED' end where id=p_job_id;
 end if;
 insert into st_job_events(job_id,user_id,event_type,payload_json) values(p_job_id,p_actor_id,p_kind,jsonb_build_object('settlementId',r.id,'amountCents',p_amount_cents,'note',p_note));return r;
end $$;
revoke all on function st_record_settlement(bigint,bigint,text,bigint,text,text) from public,anon,authenticated;
grant execute on function st_record_settlement(bigint,bigint,text,bigint,text,text) to service_role;

-- Accrual remains unchanged; only approved work contributes to payable balances.
create or replace function st_settlement_report(p_actor_id bigint,p_month text,p_before bigint default null,p_limit integer default 100) returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare u st_users%rowtype;start_date date;finish_date date;answer jsonb;
begin
 select * into strict u from st_users where id=p_actor_id and active;
 if u.role not in ('ADMIN','OWNER','CLEANER') then raise exception 'Forbidden';end if;
 if p_month !~ '^\d{4}-(0[1-9]|1[0-2])$' then raise exception 'Invalid month';end if;
 if p_limit is null or p_limit<1 or p_limit>500 then raise exception 'Invalid page size';end if;
 start_date:=(p_month||'-01')::date;finish_date:=(start_date+interval '1 month')::date;
 with eligible as (
  select j.*,o.code,o.name from st_jobs j join st_objects o on o.id=j.object_id
  where j.status='COMPLETED' and j.service_date>=start_date and j.service_date<finish_date
  and (u.role='ADMIN' or (u.role='OWNER' and j.client_id in(select id from st_client_accounts where user_id=u.id))
   or (u.role='CLEANER' and j.assigned_cleaner_id in(select id from st_cleaners where user_id=u.id and active)))
 ), amounts as (
  select j.id,j.service_date,j.code,j.name,j.review_status,round((j.client_price+j.extra_revenue)*100)::bigint charged,
    round((j.payout+j.bonus)*100)::bigint earned,
    coalesce((select sum(case kind when 'CLIENT_PAYMENT' then amount_cents when 'CLIENT_REFUND' then -amount_cents else 0 end) from st_settlements where job_id=j.id),0)::bigint received,
    coalesce((select sum(case kind when 'CLEANER_PAYOUT' then amount_cents when 'CLEANER_RETURN' then -amount_cents else 0 end) from st_settlements where job_id=j.id),0)::bigint paid
  from eligible j
 ), rows as (
  select id, jsonb_build_object('id',id,'service_date',service_date,'object_code',code,'object_name',name,'review_status',review_status)
    ||case when u.role in ('ADMIN','OWNER') then jsonb_build_object('chargedCents',charged,'receivedCents',received,'dueCents',charged-received) else '{}'::jsonb end
    ||case when u.role in ('ADMIN','CLEANER') then jsonb_build_object('earnedCents',earned,'paidCents',paid,'payableCents',case when review_status='APPROVED' then earned-paid else 0 end,'waitingReviewCents',case when review_status<>'APPROVED' then earned-paid else 0 end) else '{}'::jsonb end as row from amounts
 ) select jsonb_build_object('month',p_month,'summary',
   jsonb_build_object('jobs',count(*))
   ||case when u.role in ('ADMIN','OWNER') then jsonb_build_object('chargedCents',coalesce(sum(charged),0),'receivedCents',coalesce(sum(received),0),'dueCents',coalesce(sum(charged-received),0)) else '{}'::jsonb end
   ||case when u.role in ('ADMIN','CLEANER') then jsonb_build_object('earnedCents',coalesce(sum(earned),0),'paidCents',coalesce(sum(paid),0),'payableCents',coalesce(sum(case when review_status='APPROVED' then earned-paid else 0 end),0),'waitingReviewCents',coalesce(sum(case when review_status<>'APPROVED' then earned-paid else 0 end),0)) else '{}'::jsonb end,
   'jobs',coalesce((select jsonb_agg(row order by id desc) from (select * from rows where p_before is null or id<p_before order by id desc limit p_limit) s),'[]'::jsonb),
   'hasMore',(select count(*)>p_limit from rows where p_before is null or id<p_before),
   'nextCursor',(select min(id) from (select id from rows where p_before is null or id<p_before order by id desc limit p_limit) page)) into answer from amounts;
 return answer;
end $$;
revoke all on function st_settlement_report(bigint,text,bigint,integer) from public,anon,authenticated;
grant execute on function st_settlement_report(bigint,text,bigint,integer) to service_role;
