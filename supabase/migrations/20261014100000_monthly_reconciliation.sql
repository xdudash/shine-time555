-- Monthly reconciliation by property, with safe corrections before the first payment.
-- Existing settlement rows remain append-only; a settled job can only be corrected
-- through a refund/return, never by rewriting the historical amount or service date.

create or replace function public.st_monthly_reconciliation(p_actor_id bigint, p_month text)
returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare answer jsonb; d date;
begin
  if not exists(select 1 from public.st_users where id=p_actor_id and active and role='ADMIN') then
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
      and j.service_date>=d
      and j.service_date<d+interval '1 month'
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
$$;

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
  correction_reason text;
begin
  select * into strict actor from public.st_users where id=p_actor_id and active;
  if actor.role<>'ADMIN' then raise exception 'Forbidden'; end if;

  select * into strict job from public.st_jobs where id=p_job_id for update;
  if job.status<>'COMPLETED' then raise exception 'Only completed cleanings can be corrected'; end if;
  if exists(select 1 from public.st_settlements where job_id=job.id) or coalesce(job.financial_status,'')='PAID' then
    raise exception 'This cleaning has payment history. Record a refund or return instead of editing it';
  end if;

  if coalesce(p_body->>'serviceDate','') !~ '^\d{4}-\d{2}-\d{2}$'
     or coalesce(p_body->>'clientAmountCents','') !~ '^(0|[1-9][0-9]{0,8})$'
     or coalesce(p_body->>'cleanerAmountCents','') !~ '^(0|[1-9][0-9]{0,8})$' then
    raise exception 'Enter a valid date and non-negative amounts';
  end if;
  corrected_date := (p_body->>'serviceDate')::date;
  client_total_cents := (p_body->>'clientAmountCents')::bigint;
  cleaner_total_cents := (p_body->>'cleanerAmountCents')::bigint;
  correction_reason := nullif(left(btrim(coalesce(p_body->>'reason','')),500),'');
  if correction_reason is null then raise exception 'Correction reason is required'; end if;

  corrected_client_price := round(client_total_cents::numeric/100 - job.extra_revenue, 2);
  corrected_payout := round(cleaner_total_cents::numeric/100 - job.bonus, 2);
  if corrected_client_price<0 or corrected_payout<0 then
    raise exception 'Total cannot be lower than the existing extra charge or cleaner bonus';
  end if;
  if exists(select 1 from public.st_jobs other where other.id<>job.id and other.object_id=job.object_id and other.service_date=corrected_date) then
    raise exception 'This property already has a cleaning on that date';
  end if;

  old_service_date := job.service_date;
  insert into public.st_job_events(job_id,user_id,event_type,payload_json)
  values(job.id,actor.id,'FINANCE_CORRECTION',jsonb_build_object(
    'reason',correction_reason,
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
    set service_date=corrected_date, client_price=corrected_client_price, payout=corrected_payout
    where id=job.id returning * into job;
  return job;
end;
$$;

revoke all on function public.st_monthly_reconciliation(bigint,text) from public, anon, authenticated;
revoke all on function public.st_correct_completed_job_finance(bigint,bigint,jsonb) from public, anon, authenticated;
grant execute on function public.st_monthly_reconciliation(bigint,text) to service_role;
grant execute on function public.st_correct_completed_job_finance(bigint,bigint,jsonb) to service_role;
