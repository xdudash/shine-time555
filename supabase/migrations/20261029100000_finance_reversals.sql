-- Corrections to recorded money without rewriting history.
-- Settlement rows are immutable (update and delete are blocked by trigger). Reversing a payment
-- inserts a refund (client) or return (cleaner) row that points back to the original, so both
-- stay visible and the balance is exact. Changing a payment amount is a reversal plus a new
-- payment, in one call. Changing a cleaning's date or totals is allowed even after payment, as
-- long as the new totals do not fall below what is already paid or received.
-- A manual cleaning can be deleted only when no net money is left on it; the row is kept as
-- CANCELLED so the audit trail survives and the date can be entered again.
-- No reasons are required. All functions are administrator-only.

alter table public.st_settlements
  add column if not exists reverses_settlement_id bigint references public.st_settlements(id);
create unique index if not exists st_settlements_reverses_uidx
  on public.st_settlements(reverses_settlement_id) where reverses_settlement_id is not null;

create or replace function public.st_reverse_settlement(p_actor_id bigint, p_settlement_id bigint)
returns public.st_settlements
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  s public.st_settlements%rowtype;
  r public.st_settlements%rowtype;
  j public.st_jobs%rowtype;
  rev_kind text;
begin
  if not exists(select 1 from public.st_users where id = p_actor_id and active and role = 'ADMIN') then
    raise exception 'Forbidden';
  end if;

  select * into s from public.st_settlements where id = p_settlement_id for update;
  if not found then raise exception 'Payment not found'; end if;
  if s.kind not in ('CLIENT_PAYMENT', 'CLEANER_PAYOUT') or s.reverses_settlement_id is not null then
    raise exception 'Only a payment can be reversed';
  end if;
  if exists(select 1 from public.st_settlements where reverses_settlement_id = s.id) then
    raise exception 'This payment is already reversed';
  end if;

  select * into j from public.st_jobs where id = s.job_id for update;
  if j.status <> 'COMPLETED' or j.review_status <> 'APPROVED' then
    raise exception 'Only completed, approved cleanings can be changed';
  end if;

  rev_kind := case when s.kind = 'CLIENT_PAYMENT' then 'CLIENT_REFUND' else 'CLEANER_RETURN' end;
  insert into public.st_settlements(job_id, kind, amount_cents, note, request_id, created_by_user_id, reverses_settlement_id)
  values (s.job_id, rev_kind, s.amount_cents, 'Reversal of payment #' || s.id, 'reverse:' || s.id, p_actor_id, s.id)
  returning * into r;
  if s.kind = 'CLIENT_PAYMENT' then
    update public.st_jobs set financial_status = case when
      (select coalesce(sum(case kind when 'CLIENT_PAYMENT' then amount_cents when 'CLIENT_REFUND' then -amount_cents else 0 end), 0)
         from public.st_settlements where job_id = s.job_id) >= round((j.client_price + j.extra_revenue) * 100)
      then 'PAID' else 'INVOICED' end
    where id = s.job_id;
  end if;
  insert into public.st_job_events(job_id, user_id, event_type, payload_json)
  values (s.job_id, p_actor_id, 'PAYMENT_REVERSED', jsonb_build_object('settlementId', s.id, 'reversalId', r.id, 'amountCents', s.amount_cents));
  return r;
end
$fn$;

create or replace function public.st_correct_settlement(p_actor_id bigint, p_settlement_id bigint, p_amount_cents bigint, p_request_id text)
returns public.st_settlements
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  s public.st_settlements%rowtype;
  n public.st_settlements%rowtype;
begin
  if not exists(select 1 from public.st_users where id = p_actor_id and active and role = 'ADMIN') then
    raise exception 'Forbidden';
  end if;
  -- A repeated request returns the correction it already made instead of reversing again.
  select * into n from public.st_settlements where created_by_user_id = p_actor_id and request_id = 'correct:' || p_request_id;
  if found then return n; end if;

  select * into s from public.st_settlements where id = p_settlement_id;
  if not found then raise exception 'Payment not found'; end if;
  if s.kind not in ('CLIENT_PAYMENT', 'CLEANER_PAYOUT') then raise exception 'Only a payment can be corrected'; end if;
  if exists(select 1 from public.st_settlements where reverses_settlement_id = s.id) then
    raise exception 'This payment is already reversed';
  end if;
  if s.amount_cents = p_amount_cents then raise exception 'The amount is unchanged'; end if;

  perform public.st_reverse_settlement(p_actor_id, s.id);
  n := public.st_record_settlement(p_actor_id, s.job_id, s.kind, p_amount_cents,
        'Corrected payment #' || s.id, 'correct:' || p_request_id);
  insert into public.st_job_events(job_id, user_id, event_type, payload_json)
  values (s.job_id, p_actor_id, 'PAYMENT_CORRECTED',
          jsonb_build_object('settlementId', s.id, 'newSettlementId', n.id, 'oldAmountCents', s.amount_cents, 'newAmountCents', p_amount_cents));
  return n;
end
$fn$;

create or replace function public.st_cancel_manual_job(p_actor_id bigint, p_job_id bigint)
returns public.st_jobs
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  j public.st_jobs%rowtype;
  client_net bigint;
  cleaner_net bigint;
begin
  if not exists(select 1 from public.st_users where id = p_actor_id and active and role = 'ADMIN') then
    raise exception 'Forbidden';
  end if;
  select * into j from public.st_jobs where id = p_job_id for update;
  if not found then raise exception 'Cleaning not found'; end if;
  if j.status = 'CANCELLED' then raise exception 'This cleaning is already deleted'; end if;
  if not exists(select 1 from public.st_job_events where job_id = j.id and event_type = 'MANUAL_ENTRY') then
    raise exception 'Only a cleaning entered by hand can be deleted';
  end if;

  select coalesce(sum(case kind when 'CLIENT_PAYMENT' then amount_cents when 'CLIENT_REFUND' then -amount_cents else 0 end), 0),
         coalesce(sum(case kind when 'CLEANER_PAYOUT' then amount_cents when 'CLEANER_RETURN' then -amount_cents else 0 end), 0)
    into client_net, cleaner_net
    from public.st_settlements where job_id = j.id;
  if client_net <> 0 or cleaner_net <> 0 then
    raise exception 'Reverse the payments on this cleaning first';
  end if;

  update public.st_jobs set status = 'CANCELLED', marketplace_visible = false where id = j.id returning * into j;
  insert into public.st_job_events(job_id, user_id, event_type, payload_json)
  values (j.id, p_actor_id, 'MANUAL_CANCELLED', '{}'::jsonb);
  return j;
end
$fn$;

-- Date and totals of a completed cleaning, editable even after payment. The new totals may not
-- fall below what is already paid or received; reverse those payments first in that case.
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
  client_net bigint;
  cleaner_net bigint;
  has_history boolean;
begin
  select * into strict actor from public.st_users where id=p_actor_id and active;
  if actor.role<>'ADMIN' then raise exception 'Forbidden'; end if;

  select * into strict job from public.st_jobs where id=p_job_id for update;
  if job.status<>'COMPLETED' or job.review_status<>'APPROVED' then raise exception 'Only quality-approved completed cleanings can be corrected'; end if;

  if coalesce(p_body->>'serviceDate','') !~ '^\d{4}-\d{2}-\d{2}$'
     or coalesce(p_body->>'clientAmountCents','') !~ '^(0|[1-9][0-9]{0,8})$'
     or coalesce(p_body->>'cleanerAmountCents','') !~ '^(0|[1-9][0-9]{0,8})$' then
    raise exception 'Enter a valid date and non-negative amounts';
  end if;
  corrected_date := (p_body->>'serviceDate')::date;
  client_total_cents := (p_body->>'clientAmountCents')::bigint;
  cleaner_total_cents := (p_body->>'cleanerAmountCents')::bigint;

  corrected_client_price := round(client_total_cents::numeric/100 - job.extra_revenue, 2);
  corrected_payout := round(cleaner_total_cents::numeric/100 - job.bonus, 2);
  if corrected_client_price<0 or corrected_payout<0 then
    raise exception 'Total cannot be lower than the existing extra charge or cleaner bonus';
  end if;
  if exists(select 1 from public.st_jobs other where other.id<>job.id and other.object_id=job.object_id and other.service_date=corrected_date and other.status not in ('CANCELLED','EXPIRED')) then
    raise exception 'This property already has a cleaning on that date';
  end if;

  select coalesce(sum(case kind when 'CLIENT_PAYMENT' then amount_cents when 'CLIENT_REFUND' then -amount_cents else 0 end), 0),
         coalesce(sum(case kind when 'CLEANER_PAYOUT' then amount_cents when 'CLEANER_RETURN' then -amount_cents else 0 end), 0),
         exists(select 1 from public.st_settlements where job_id=job.id)
    into client_net, cleaner_net, has_history
    from public.st_settlements where job_id=job.id;
  if client_total_cents < client_net then
    raise exception 'The client has already paid more than this total. Reverse the payment first';
  end if;
  if cleaner_total_cents < cleaner_net then
    raise exception 'The cleaner has already been paid more than this total. Reverse the payout first';
  end if;

  old_service_date := job.service_date;
  insert into public.st_job_events(job_id,user_id,event_type,payload_json)
  values(job.id,actor.id,'FINANCE_CORRECTION',jsonb_build_object(
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
    set service_date=corrected_date, client_price=corrected_client_price, payout=corrected_payout,
        financial_status = case when has_history then
          (case when client_net >= client_total_cents then 'PAID' else 'INVOICED' end) else financial_status end
    where id=job.id returning * into job;
  return job;
end;
$$;

revoke all on function public.st_reverse_settlement(bigint, bigint) from public, anon, authenticated;
revoke all on function public.st_correct_settlement(bigint, bigint, bigint, text) from public, anon, authenticated;
revoke all on function public.st_cancel_manual_job(bigint, bigint) from public, anon, authenticated;
revoke all on function public.st_correct_completed_job_finance(bigint, bigint, jsonb) from public, anon, authenticated;
grant execute on function public.st_reverse_settlement(bigint, bigint) to service_role;
grant execute on function public.st_correct_settlement(bigint, bigint, bigint, text) to service_role;
grant execute on function public.st_cancel_manual_job(bigint, bigint) to service_role;
grant execute on function public.st_correct_completed_job_finance(bigint, bigint, jsonb) to service_role;
