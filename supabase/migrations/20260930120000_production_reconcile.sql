-- Production reconciliation (2026-10-01): aligns production-only monthly settlements
-- with the quality-review gate and closes advisor findings. Additive and idempotent.

-- Monthly settlement lists only jobs a manager has approved. Unapproved completed jobs
-- are reported separately so the admin still sees money waiting for review.
create or replace function st_monthly_settlements(p_actor_id bigint,p_month text,p_side text,p_party_id bigint default null)
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
  where j.status='COMPLETED' and j.review_status='APPROVED' and j.service_date>=d and j.service_date<d+interval '1 month'
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
  'hasMore',(select count(*)>5000 from amounts where party_id=p_party_id),
  'waitingReviewJobs',(select count(*) from st_jobs j where j.status='COMPLETED' and j.review_status<>'APPROVED' and j.service_date>=d and j.service_date<d+interval '1 month')) into answer;
 return answer;
end$$;
revoke all on function st_monthly_settlements(bigint,text,text,bigint) from public,anon,authenticated;
grant execute on function st_monthly_settlements(bigint,text,text,bigint) to service_role;

-- st_settle_batch delegates each row to st_record_settlement, which already refuses
-- unapproved jobs and rolls back the whole batch. No change is required there.

-- Advisor: trigger-only functions must not be callable through the Data API.
revoke all on function public.st_signal_job_change() from public,anon,authenticated;
revoke all on function public.st_settlement_immutable() from public,anon,authenticated;
-- Advisor: pin search_path on the immutability trigger.
alter function public.st_settlement_immutable() set search_path=public,pg_temp;

-- Backend-only tables must not carry browser grants even though RLS already denies them.
do $$
declare t text;
begin
 foreach t in array array['st_manager_properties','st_user_permissions'] loop
  if to_regclass('public.'||t) is not null then
   execute format('revoke all on table public.%I from anon, authenticated', t);
  end if;
 end loop;
end $$;
