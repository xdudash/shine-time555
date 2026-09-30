-- Recovered verbatim from production (supabase_migrations.schema_migrations, version 20260909150213)
-- on 2026-10-01. Already applied in production; kept here so fresh environments match.
-- Monthly counterparties and atomic allocation of one receipt/payout to selected jobs.
create table st_settlement_batches (
 id bigint generated always as identity primary key,
 actor_id bigint not null references st_users(id), request_id text not null,
 payload jsonb not null, result jsonb not null, created_at timestamptz not null default now(),
 unique(actor_id,request_id)
);
alter table st_settlement_batches enable row level security;
revoke all on st_settlement_batches from public,anon,authenticated;
grant select on st_settlement_batches to service_role;

create function st_monthly_settlements(p_actor_id bigint,p_month text,p_side text,p_party_id bigint default null)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare answer jsonb; d date;
begin
 if not exists(select 1 from st_users where id=p_actor_id and active and role='ADMIN') then raise exception 'Forbidden';end if;
 if p_month is null or p_month !~ '^\d{4}-(0[1-9]|1[0-2])$' or p_side is null or p_side not in ('CLIENT','CLEANER') then raise exception 'Invalid period or side';end if;
 d:=(p_month||'-01')::date;
 with eligible as (
  select j.*,o.name object_name,case when p_side='CLIENT' then j.client_id else j.assigned_cleaner_id end party_id,
   case when p_side='CLIENT' then coalesce(nullif(c.company_name,''),cu.full_name) else eu.full_name end party_name
  from st_jobs j join st_objects o on o.id=j.object_id
  left join st_client_accounts c on c.id=j.client_id left join st_users cu on cu.id=c.user_id
  left join st_cleaners e on e.id=j.assigned_cleaner_id left join st_users eu on eu.id=e.user_id
  where j.status='COMPLETED' and j.service_date>=d and j.service_date<d+interval '1 month'
 ), paid as (
  select s.job_id,sum(case when p_side='CLIENT' and s.kind='CLIENT_PAYMENT' or p_side='CLEANER' and s.kind='CLEANER_PAYOUT' then s.amount_cents
   when p_side='CLIENT' and s.kind='CLIENT_REFUND' or p_side='CLEANER' and s.kind='CLEANER_RETURN' then -s.amount_cents else 0 end)::bigint amount
  from st_settlements s join eligible j on j.id=s.job_id group by s.job_id
 ), amounts as (
  select j.id,j.object_name,j.service_date,j.party_id,j.party_name,
   round(case when p_side='CLIENT' then j.client_price+j.extra_revenue else j.payout+j.bonus end*100)::bigint charged,
   coalesce(p.amount,0)::bigint paid from eligible j left join paid p on p.job_id=j.id
 ), groups as (
  select party_id id,coalesce(party_name,'—') name,count(*) count,sum(charged)::bigint charged,sum(paid)::bigint paid,sum(charged-paid)::bigint due
  from amounts group by party_id,party_name
 ), detail as (
  select * from amounts where party_id=p_party_id order by service_date,id limit 5000
 ) select jsonb_build_object('groups',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'count',count,'chargedCents',charged,'paidCents',paid,'dueCents',due) order by name,id) from groups),'[]'::jsonb),
  'jobs',coalesce((select jsonb_agg(jsonb_build_object('id',id,'object_name',object_name,'service_date',service_date,'chargedCents',charged,'paidCents',paid,'dueCents',charged-paid) order by service_date,id) from detail),'[]'::jsonb),
  'hasMore',(select count(*)>5000 from amounts where party_id=p_party_id)) into answer;
 return answer;
end$$;

create function st_settle_batch(p_actor_id bigint,p_month text,p_side text,p_party_id bigint,p_items jsonb,p_note text,p_request_id text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare canonical jsonb;payload jsonb;old st_settlement_batches%rowtype;item record;j st_jobs%rowtype;
 received bigint;owed bigint;amount bigint:=0;n integer:=0;answer jsonb;d date;v_kind text;note text;
begin
 if not exists(select 1 from st_users where id=p_actor_id and active and role='ADMIN') then raise exception 'Forbidden';end if;
 if p_month is null or p_month !~ '^\d{4}-(0[1-9]|1[0-2])$' or p_side is null or p_side not in ('CLIENT','CLEANER') or p_party_id is null then raise exception 'Invalid period or counterparty';end if;
 if p_items is null or jsonb_typeof(p_items)<>'array' then raise exception 'Select jobs';end if;
 if jsonb_array_length(p_items) not between 1 and 5000 or length(coalesce(p_request_id,'')) not between 1 and 100 then raise exception 'Invalid batch or request id';end if;
 if exists(select 1 from jsonb_array_elements(p_items) e where coalesce(e->>'jobId','') !~ '^[1-9][0-9]*$' or coalesce(e->>'amountCents','') !~ '^[1-9][0-9]*$') then raise exception 'Invalid job or amount';end if;
 select jsonb_agg(jsonb_build_object('jobId',(e->>'jobId')::bigint,'amountCents',(e->>'amountCents')::bigint) order by (e->>'jobId')::bigint) into canonical from jsonb_array_elements(p_items) e;
 if (select count(distinct e->>'jobId') from jsonb_array_elements(canonical) e)<>jsonb_array_length(canonical) then raise exception 'Duplicate job';end if;
 payload:=jsonb_build_object('month',p_month,'side',p_side,'party',p_party_id,'items',canonical,'note',coalesce(p_note,''));
 perform pg_advisory_xact_lock(hashtext('batch:'||p_actor_id::text||':'||p_request_id));
 select * into old from st_settlement_batches where actor_id=p_actor_id and request_id=p_request_id;
 if found then if old.payload<>payload then raise exception 'Request id already used';end if;return old.result;end if;
 d:=(p_month||'-01')::date;v_kind:=case when p_side='CLIENT' then 'CLIENT_PAYMENT' else 'CLEANER_PAYOUT' end;
 note:=coalesce(nullif(btrim(p_note),''),'Monthly settlement '||p_month);
 -- Locks always follow job id order. Any invalid/stale row rolls the entire batch back.
 for item in select * from jsonb_to_recordset(canonical) as x("jobId" bigint,"amountCents" bigint) order by "jobId" loop
  select * into j from st_jobs where id=item."jobId" for update;
  if not found then raise exception 'Job not found';end if;
  if (case when p_side='CLIENT' then j.client_id else j.assigned_cleaner_id end) is distinct from p_party_id then raise exception 'Wrong counterparty';end if;
  if j.status<>'COMPLETED' or j.service_date<d or j.service_date>=d+interval '1 month' then raise exception 'Job outside completed period';end if;
  select coalesce(sum(case when s.kind=v_kind then s.amount_cents when s.kind=case when p_side='CLIENT' then 'CLIENT_REFUND' else 'CLEANER_RETURN' end then -s.amount_cents else 0 end),0) into received from st_settlements s where s.job_id=j.id;
  owed:=round(case when p_side='CLIENT' then j.client_price+j.extra_revenue else j.payout+j.bonus end*100)::bigint-received;
  if owed<=0 or owed<>item."amountCents" then raise exception 'Balance changed. Refresh the list and select jobs again';end if;
  perform st_record_settlement(p_actor_id,j.id,v_kind,item."amountCents",note,'batch:'||p_request_id||':'||j.id);
  amount:=amount+item."amountCents";n:=n+1;
 end loop;
 answer:=jsonb_build_object('count',n,'amountCents',amount);
 insert into st_settlement_batches(actor_id,request_id,payload,result) values(p_actor_id,p_request_id,payload,answer);
 return answer;
end$$;
revoke all on function st_monthly_settlements(bigint,text,text,bigint) from public,anon,authenticated;
revoke all on function st_settle_batch(bigint,text,text,bigint,jsonb,text,text) from public,anon,authenticated;
grant execute on function st_monthly_settlements(bigint,text,text,bigint) to service_role;
grant execute on function st_settle_batch(bigint,text,text,bigint,jsonb,text,text) to service_role;
