-- Additive operations extension. All mutations are service-side, checked by actor.
alter table st_objects add column if not exists service_category text not null default 'SHORT_STAY'
 check(service_category in ('SHORT_STAY','HOME','OFFICE','COMMON_AREAS','OTHER'));
create table st_recurring(
 id bigint generated always as identity primary key,
 object_id bigint not null references st_objects(id),
 created_by_user_id bigint not null references st_users(id),
 start_date date not null,end_date date,
 weekdays integer[] not null default array[1,2,3,4,5,6,7],
 planned_start time not null,active boolean not null default true,
 created_at timestamptz not null default now(),
 check(end_date is null or end_date>=start_date),
 check(cardinality(weekdays)>0 and weekdays <@ array[1,2,3,4,5,6,7])
);
alter table st_recurring enable row level security;
revoke all on st_recurring from public,anon,authenticated;
grant all on st_recurring to service_role;
grant usage,select on sequence st_recurring_id_seq to service_role;
alter table st_jobs add column if not exists recurring_id bigint references st_recurring(id);
create index st_recurring_active_idx on st_recurring(active,start_date) where active;

create or replace function st_create_job(p_actor_id bigint,p_body jsonb) returns st_jobs
language plpgsql security definer set search_path=public,pg_temp as $$
declare
 u st_users%rowtype;o st_objects%rowtype;j st_jobs%rowtype;c st_cleaners%rowtype;
 d date;start_at time;end_at time;duration integer;is_client boolean;new_id bigint;safety integer;travel integer;
begin
 select * into strict u from st_users where id=p_actor_id and active;
 if u.role not in ('ADMIN','OPERATIONS_MANAGER','OWNER','PROPERTY_MANAGER') then raise exception 'Forbidden';end if;
 select * into strict o from st_objects where id=(p_body->>'objectId')::bigint and active and approval_status='APPROVED';
 safety:=greatest(0,coalesce((select value_json::text::integer from st_settings where setting_key='safetyBuffer'),10));
 travel:=greatest(0,coalesce((select value_json::text::integer from st_settings where setting_key='travelBuffer'),15));
 is_client:=u.role in ('OWNER','PROPERTY_MANAGER');
 if is_client and not exists(select 1 from st_client_accounts ca where ca.user_id=u.id and
   ((u.role='OWNER' and ca.id=o.client_id) or (u.role='PROPERTY_MANAGER' and exists(select 1 from st_manager_properties mp where mp.manager_client_id=ca.id and mp.object_id=o.id)))) then raise exception 'Forbidden';end if;
 d:=(p_body->>'serviceDate')::date;
 if d is null or d<(now() at time zone 'Europe/Bratislava')::date or d>(now() at time zone 'Europe/Bratislava')::date+366 then raise exception 'Invalid service date';end if;
 start_at:=coalesce((p_body->>'plannedStart')::time,(p_body->>'earliestStart')::time,o.checkout_time);
 end_at:=case when is_client then o.deadline_time else coalesce((p_body->>'deadline')::time,o.deadline_time) end;
 duration:=case when is_client then o.duration_minutes else coalesce((p_body->>'durationMinutes')::int,o.duration_minutes) end;
 if duration<15 or duration>1440 or start_at<o.checkout_time or end_at>o.deadline_time or start_at>=end_at or d+start_at+make_interval(mins=>duration)>d+end_at then raise exception 'Invalid object service window';end if;
 if d=(now() at time zone 'Europe/Bratislava')::date and start_at<(now() at time zone 'Europe/Bratislava')::time then raise exception 'Start time has passed';end if;
 perform pg_advisory_xact_lock(hashtext(d::text));
 if exists(select 1 from st_jobs where object_id=o.id and service_date=d) then raise exception 'A booking already exists for this property and date';end if;
 if is_client then
   select cl.* into c from st_cleaners cl join st_users cu on cu.id=cl.user_id and cu.active
   join st_cleaner_availability a on a.cleaner_id=cl.id and a.service_date=d and a.online
   where cl.active and a.from_time<=start_at and d+start_at+make_interval(mins=>duration+safety)<=d+least(a.to_time,end_at)
   and (select count(*) from st_jobs x where x.assigned_cleaner_id=cl.id and x.service_date=d and x.status<>'CANCELLED')<cl.max_jobs_day
   and not exists(select 1 from st_jobs x where x.assigned_cleaner_id=cl.id and x.service_date=d and x.status<>'CANCELLED'
     and d+start_at<d+coalesce(x.planned_start,x.earliest_start)+make_interval(mins=>x.duration_minutes+safety+travel)
     and d+start_at+make_interval(mins=>duration+safety+travel)>d+coalesce(x.planned_start,x.earliest_start))
   order by (select count(*) from st_jobs x where x.assigned_cleaner_id=cl.id and x.service_date=d and x.status<>'CANCELLED'),cl.id limit 1;
   if not found then raise exception 'No cleaner is available for this slot. Choose another time';end if;
 end if;
 insert into st_jobs(object_id,client_id,service_date,earliest_start,deadline,duration_minutes,payout,client_price,bonus,planned_start,eta,booking_source,created_by_user_id,status,assigned_cleaner_id,marketplace_visible,accepted_at)
 values(o.id,o.client_id,d,start_at,end_at,duration,
   case when is_client or u.role='OPERATIONS_MANAGER' then o.payout else coalesce((p_body->>'payout')::numeric,o.payout) end,
   case when is_client or u.role='OPERATIONS_MANAGER' then o.client_price else coalesce((p_body->>'clientPrice')::numeric,o.client_price) end,
   case when is_client then 0 else greatest(0,coalesce((p_body->>'bonus')::numeric,0)) end,
   start_at,start_at+make_interval(mins=>duration),case when is_client then 'CLIENT' else 'ADMIN' end,u.id,
   case when is_client then 'ACCEPTED' else 'UNASSIGNED' end,c.id,not is_client,case when is_client then now() end) returning * into j;
 if j.payout<0 or j.client_price<0 then raise exception 'Negative amount is not allowed';end if;
 insert into st_job_checklist(job_id,checklist_item_id,label,required,photo_required,photo_category,sort_order)
 select j.id,id,label,required,photo_required,photo_category,sort_order from st_checklist_items where object_id=o.id;
 if not found then
   insert into st_job_checklist(job_id,label,required,photo_required,photo_category,sort_order) values
   (j.id,'Complete property instructions',true,false,null,1),(j.id,'Final quality inspection',true,false,null,2),(j.id,'Final proof photo',true,true,'Final',3);
 end if;
 insert into st_job_events(job_id,user_id,event_type,payload_json) values(j.id,u.id,'JOB_CREATED',jsonb_build_object('source',j.booking_source));
 if is_client then insert into st_notifications(user_id,type,title,message) values(c.user_id,'ASSIGNED','New job assigned','Cleaning #'||j.id);end if;
 return j;
end $$;
revoke all on function st_create_job(bigint,jsonb) from public,anon,authenticated;
grant execute on function st_create_job(bigint,jsonb) to service_role;

create function st_generate_recurring(p_actor_id bigint,p_recurring_id bigint,p_until date) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare r st_recurring%rowtype;d date;j st_jobs%rowtype;n int:=0;skipped int:=0;first_date date;
begin
 if not exists(select 1 from st_users where id=p_actor_id and active and role in ('ADMIN','OPERATIONS_MANAGER')) then raise exception 'Forbidden';end if;
 select * into strict r from st_recurring where id=p_recurring_id and active for update;
 first_date:=greatest(r.start_date,(now() at time zone 'Europe/Bratislava')::date);
 if p_until<first_date or p_until>first_date+90 then raise exception 'Generate a range of at most 90 days';end if;
 for d in select g::date from generate_series(first_date,least(p_until,coalesce(r.end_date,p_until)),interval '1 day') g loop
   if extract(isodow from d)::int=any(r.weekdays) then
     perform pg_advisory_xact_lock(hashtext(d::text));
     if exists(select 1 from st_jobs where object_id=r.object_id and service_date=d) then skipped:=skipped+1;continue;end if;
     if d=(now() at time zone 'Europe/Bratislava')::date and r.planned_start<(now() at time zone 'Europe/Bratislava')::time then skipped:=skipped+1;continue;end if;
     j:=st_create_job(p_actor_id,jsonb_build_object('objectId',r.object_id,'serviceDate',d,'plannedStart',r.planned_start));
     update st_jobs set recurring_id=r.id where id=j.id;n:=n+1;
   end if;
 end loop;
 return jsonb_build_object('created',n,'skipped',skipped);
end $$;
revoke all on function st_generate_recurring(bigint,bigint,date) from public,anon,authenticated;
grant execute on function st_generate_recurring(bigint,bigint,date) to service_role;

create table st_settlements(
 id bigint generated always as identity primary key,
 job_id bigint not null references st_jobs(id),
 kind text not null check(kind in ('CLIENT_PAYMENT','CLEANER_PAYOUT','CLIENT_REFUND','CLEANER_RETURN')),
 amount_cents bigint not null check(amount_cents>0 and amount_cents<=100000000),
 note text not null check(length(btrim(note))>0),
 request_id text not null,
 created_by_user_id bigint not null references st_users(id),
 created_at timestamptz not null default now(),
 unique(created_by_user_id,request_id)
);
alter table st_settlements enable row level security;
revoke all on st_settlements from public,anon,authenticated;
grant select on st_settlements to service_role;
create index st_settlements_job_idx on st_settlements(job_id);
create function st_settlement_immutable() returns trigger language plpgsql as $$begin raise exception 'Settlement entries are immutable. Record a refund or return';end$$;
create trigger st_settlement_no_edit before update or delete on st_settlements for each row execute function st_settlement_immutable();

create function st_record_settlement(p_actor_id bigint,p_job_id bigint,p_kind text,p_amount_cents bigint,p_note text,p_request_id text) returns st_settlements
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

create function st_settlement_report(p_actor_id bigint,p_month text,p_before bigint default null,p_limit integer default 100) returns jsonb
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
  select j.id,j.service_date,j.code,j.name,round((j.client_price+j.extra_revenue)*100)::bigint charged,
    round((j.payout+j.bonus)*100)::bigint earned,
    coalesce((select sum(case kind when 'CLIENT_PAYMENT' then amount_cents when 'CLIENT_REFUND' then -amount_cents else 0 end) from st_settlements where job_id=j.id),0)::bigint received,
    coalesce((select sum(case kind when 'CLEANER_PAYOUT' then amount_cents when 'CLEANER_RETURN' then -amount_cents else 0 end) from st_settlements where job_id=j.id),0)::bigint paid
  from eligible j
 ), rows as (
  select id, jsonb_build_object('id',id,'service_date',service_date,'object_code',code,'object_name',name)
    ||case when u.role in ('ADMIN','OWNER') then jsonb_build_object('chargedCents',charged,'receivedCents',received,'dueCents',charged-received) else '{}'::jsonb end
    ||case when u.role in ('ADMIN','CLEANER') then jsonb_build_object('earnedCents',earned,'paidCents',paid,'payableCents',earned-paid) else '{}'::jsonb end as row from amounts
 ) select jsonb_build_object('month',p_month,'summary',
   jsonb_build_object('jobs',count(*))
   ||case when u.role in ('ADMIN','OWNER') then jsonb_build_object('chargedCents',coalesce(sum(charged),0),'receivedCents',coalesce(sum(received),0),'dueCents',coalesce(sum(charged-received),0)) else '{}'::jsonb end
   ||case when u.role in ('ADMIN','CLEANER') then jsonb_build_object('earnedCents',coalesce(sum(earned),0),'paidCents',coalesce(sum(paid),0),'payableCents',coalesce(sum(earned-paid),0)) else '{}'::jsonb end,
   'jobs',coalesce((select jsonb_agg(row order by id desc) from (select * from rows where p_before is null or id<p_before order by id desc limit p_limit) s),'[]'::jsonb),
   'hasMore',(select count(*)>p_limit from rows where p_before is null or id<p_before),
   'nextCursor',(select min(id) from (select id from rows where p_before is null or id<p_before order by id desc limit p_limit) page)) into answer from amounts;
 return answer;
end $$;
revoke all on function st_settlement_report(bigint,text,bigint,integer) from public,anon,authenticated;
grant execute on function st_settlement_report(bigint,text,bigint,integer) to service_role;
