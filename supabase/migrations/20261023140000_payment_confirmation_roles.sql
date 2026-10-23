-- Payment confirmation by operations managers and property managers.
-- Business owner (ADMIN) keeps full access. OPERATIONS_MANAGER gets all objects.
-- PROPERTY_MANAGER gets only objects linked through st_manager_properties.
-- OWNER (a client account) is deliberately excluded: clients are the payer and must not confirm their own payments.
-- Recorded settlements stay append-only; these functions only change who may call them.

create or replace function public.st_settlement_actor_scope(p_actor_id bigint, p_object_id bigint)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select exists(
    select 1 from public.st_users u
    where u.id = p_actor_id and u.active and (
      u.role in ('ADMIN','OPERATIONS_MANAGER')
      or (u.role = 'PROPERTY_MANAGER' and p_object_id in (
        select mp.object_id from public.st_manager_properties mp
        join public.st_client_accounts ca on ca.id = mp.manager_client_id
        where ca.user_id = u.id))
    )
  );
$fn$;

create or replace function public.st_record_settlement(p_actor_id bigint, p_job_id bigint, p_kind text, p_amount_cents bigint, p_note text, p_request_id text)
 returns st_settlements
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare j st_jobs%rowtype;r st_settlements%rowtype;total bigint;received bigint;paid bigint;
begin
 if not exists(select 1 from st_users where id=p_actor_id and active and role in ('ADMIN','OPERATIONS_MANAGER','PROPERTY_MANAGER')) then raise exception 'Forbidden';end if;
 if p_amount_cents<=0 or p_amount_cents>100000000 or p_amount_cents is null or length(btrim(coalesce(p_note,'')))=0 or length(coalesce(p_request_id,'')) not between 1 and 200 then raise exception 'Invalid settlement amount, note or request id';end if;
 perform pg_advisory_xact_lock(hashtext(p_actor_id::text||':'||p_request_id));
 select * into r from st_settlements where created_by_user_id=p_actor_id and request_id=p_request_id;
 if found then
   if r.job_id<>p_job_id or r.kind<>p_kind or r.amount_cents<>p_amount_cents then raise exception 'Request id already used';end if;return r;
 end if;
 select * into strict j from st_jobs where id=p_job_id for update;
 if not st_settlement_actor_scope(p_actor_id, j.object_id) then raise exception 'Forbidden';end if;
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
end $function$;

create or replace function public.st_settle_batch(p_actor_id bigint, p_month text, p_side text, p_party_id bigint, p_items jsonb, p_note text, p_request_id text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare canonical jsonb;payload jsonb;old st_settlement_batches%rowtype;item record;j st_jobs%rowtype;
 received bigint;owed bigint;amount bigint:=0;n integer:=0;answer jsonb;d date;v_kind text;note text;
begin
 if not exists(select 1 from st_users where id=p_actor_id and active and role in ('ADMIN','OPERATIONS_MANAGER','PROPERTY_MANAGER')) then raise exception 'Forbidden';end if;
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
end$function$;

create or replace function public.st_monthly_settlements(p_actor_id bigint, p_month text, p_side text, p_party_id bigint default null::bigint)
 returns jsonb
 language plpgsql
 stable
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare answer jsonb; d date;
begin
 if not exists(select 1 from st_users where id=p_actor_id and active and role in ('ADMIN','OPERATIONS_MANAGER','PROPERTY_MANAGER')) then raise exception 'Forbidden';end if;
 if p_month is null or p_month !~ '^\d{4}-(0[1-9]|1[0-2])$' or p_side is null or p_side not in ('CLIENT','CLEANER') then raise exception 'Invalid period or side';end if;
 d:=(p_month||'-01')::date;
 with eligible as (
  select j.*,o.name object_name,case when p_side='CLIENT' then j.client_id else j.assigned_cleaner_id end party_id,
   case when p_side='CLIENT' then coalesce(nullif(c.company_name,''),cu.full_name) else eu.full_name end party_name
  from st_jobs j join st_objects o on o.id=j.object_id
  left join st_client_accounts c on c.id=j.client_id left join st_users cu on cu.id=c.user_id
  left join st_cleaners e on e.id=j.assigned_cleaner_id left join st_users eu on eu.id=e.user_id
  where j.status='COMPLETED' and j.review_status='APPROVED' and j.service_date>=d and j.service_date<d+interval '1 month'
   and st_settlement_actor_scope(p_actor_id, j.object_id)
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
  'waitingReviewJobs',(select count(*) from st_jobs j where j.status='COMPLETED' and j.review_status<>'APPROVED' and j.service_date>=d and j.service_date<d+interval '1 month' and st_settlement_actor_scope(p_actor_id, j.object_id))) into answer;
 return answer;
end$function$;

create or replace function public.st_monthly_reconciliation(p_actor_id bigint, p_month text)
 returns jsonb
 language plpgsql
 stable
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare answer jsonb; d date;
begin
  if not exists(select 1 from public.st_users where id=p_actor_id and active and role in ('ADMIN','OPERATIONS_MANAGER','PROPERTY_MANAGER')) then
    raise exception 'Forbidden';
  end if;
  if p_month is null or p_month !~ '^\d{4}-(0[1-9]|1[0-2])$' then
    raise exception 'Invalid period';
  end if;
  d := (p_month || '-01')::date;

  with eligible as (
    select
      j.id, j.object_id, o.code as object_code, o.name as object_name,
      j.client_id, coalesce(nullif(c.company_name,''), cu.full_name, '—') as client_name,
      j.assigned_cleaner_id as cleaner_id, coalesce(eu.full_name, '—') as cleaner_name,
      j.service_date,
      round((j.client_price + j.extra_revenue) * 100)::bigint as client_amount_cents,
      round((j.payout + j.bonus) * 100)::bigint as cleaner_amount_cents,
      j.client_price, j.extra_revenue, j.payout, j.bonus, j.financial_status,
      not exists(select 1 from public.st_settlements s where s.job_id=j.id) as has_no_settlements
    from public.st_jobs j
    join public.st_objects o on o.id=j.object_id
    left join public.st_client_accounts c on c.id=j.client_id
    left join public.st_users cu on cu.id=c.user_id
    left join public.st_cleaners e on e.id=j.assigned_cleaner_id
    left join public.st_users eu on eu.id=e.user_id
    where j.status='COMPLETED'
      and j.review_status='APPROVED'
      and j.service_date>=d
      and j.service_date<d+interval '1 month'
      and public.st_settlement_actor_scope(p_actor_id, j.object_id)
  ), paid as (
    select s.job_id,
      coalesce(sum(case s.kind when 'CLIENT_PAYMENT' then s.amount_cents when 'CLIENT_REFUND' then -s.amount_cents else 0 end),0)::bigint as client_paid_cents,
      coalesce(sum(case s.kind when 'CLEANER_PAYOUT' then s.amount_cents when 'CLEANER_RETURN' then -s.amount_cents else 0 end),0)::bigint as cleaner_paid_cents
    from public.st_settlements s join eligible j on j.id=s.job_id
    group by s.job_id
  ), detail as (
    select e.*,
      coalesce(p.client_paid_cents,0)::bigint as client_paid_cents,
      coalesce(p.cleaner_paid_cents,0)::bigint as cleaner_paid_cents,
      (e.client_amount_cents-coalesce(p.client_paid_cents,0))::bigint as client_due_cents,
      (e.cleaner_amount_cents-coalesce(p.cleaner_paid_cents,0))::bigint as cleaner_due_cents,
      (e.has_no_settlements and coalesce(e.financial_status,'')<>'PAID') as editable
    from eligible e left join paid p on p.job_id=e.id
  ), object_rollup as (
    select object_id, object_code, object_name, count(*)::integer as jobs_count,
      string_agg(distinct client_name, ', ' order by client_name) as client_names,
      string_agg(distinct cleaner_name, ', ' order by cleaner_name) filter (where cleaner_id is not null) as cleaner_names,
      sum(client_amount_cents)::bigint as client_amount_cents,
      sum(client_paid_cents)::bigint as client_paid_cents,
      sum(client_due_cents)::bigint as client_due_cents,
      sum(cleaner_amount_cents)::bigint as cleaner_amount_cents,
      sum(cleaner_paid_cents)::bigint as cleaner_paid_cents,
      sum(cleaner_due_cents)::bigint as cleaner_due_cents
    from detail group by object_id, object_code, object_name
  ), job_rows as (
    select * from detail order by object_code, service_date, id limit 5000
  )
  select jsonb_build_object(
    'month', p_month,
    'summary', jsonb_build_object(
      'jobsCount', (select count(*) from detail),
      'clientAmountCents', coalesce((select sum(client_amount_cents) from detail),0),
      'clientPaidCents', coalesce((select sum(client_paid_cents) from detail),0),
      'clientDueCents', coalesce((select sum(client_due_cents) from detail),0),
      'cleanerAmountCents', coalesce((select sum(cleaner_amount_cents) from detail),0),
      'cleanerPaidCents', coalesce((select sum(cleaner_paid_cents) from detail),0),
      'cleanerDueCents', coalesce((select sum(cleaner_due_cents) from detail),0)
    ),
    'objects', coalesce((
      select jsonb_agg(jsonb_build_object(
        'objectId', object_id, 'objectCode', object_code, 'objectName', object_name,
        'jobsCount', jobs_count, 'clientNames', client_names, 'cleanerNames', cleaner_names,
        'clientAmountCents', client_amount_cents, 'clientPaidCents', client_paid_cents, 'clientDueCents', client_due_cents,
        'cleanerAmountCents', cleaner_amount_cents, 'cleanerPaidCents', cleaner_paid_cents, 'cleanerDueCents', cleaner_due_cents
      ) order by object_code, object_name, object_id) from object_rollup
    ), '[]'::jsonb),
    'jobs', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', id, 'objectId', object_id, 'objectCode', object_code, 'objectName', object_name,
        'clientId', client_id, 'clientName', client_name, 'cleanerId', cleaner_id, 'cleanerName', cleaner_name,
        'serviceDate', service_date,
        'clientAmountCents', client_amount_cents, 'clientPaidCents', client_paid_cents, 'clientDueCents', client_due_cents,
        'cleanerAmountCents', cleaner_amount_cents, 'cleanerPaidCents', cleaner_paid_cents, 'cleanerDueCents', cleaner_due_cents,
        'clientPriceCents', round(client_price*100)::bigint, 'extraRevenueCents', round(extra_revenue*100)::bigint,
        'payoutCents', round(payout*100)::bigint, 'bonusCents', round(bonus*100)::bigint,
        'editable', editable
      ) order by object_code, service_date, id) from job_rows
    ), '[]'::jsonb),
    'hasMore', (select count(*)>5000 from detail)
  ) into answer;
  return answer;
end;
$function$;
