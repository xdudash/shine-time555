-- Corrections to recorded money without rewriting history.
-- A payment is never edited or deleted in place. Reversing it adds a refund (client) or
-- return (cleaner) row that points back to the original, so both stay visible and the
-- balance is exact. Correcting an amount is a reversal plus a new payment, in one call.
-- A manual cleaning can be cancelled only when no net money is left on it; the row is
-- kept with status CANCELLED so the audit trail survives and the date can be re-entered.
-- All three functions are administrator-only.

alter table public.st_settlements
  add column if not exists reverses_settlement_id bigint references public.st_settlements(id);
create unique index if not exists st_settlements_reverses_uidx
  on public.st_settlements(reverses_settlement_id) where reverses_settlement_id is not null;

create or replace function public.st_reverse_settlement(p_actor_id bigint, p_settlement_id bigint, p_reason text)
returns public.st_settlements
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  s public.st_settlements%rowtype;
  r public.st_settlements%rowtype;
  j public.st_jobs%rowtype;
  reason text;
  rev_kind text;
begin
  if not exists(select 1 from public.st_users where id = p_actor_id and active and role = 'ADMIN') then
    raise exception 'Forbidden';
  end if;
  reason := left(btrim(coalesce(p_reason, '')), 300);
  if length(reason) = 0 then raise exception 'A reason is required'; end if;

  select * into s from public.st_settlements where id = p_settlement_id for update;
  if not found then raise exception 'Payment not found'; end if;
  if s.kind not in ('CLIENT_PAYMENT', 'CLEANER_PAYOUT') or s.reverses_settlement_id is not null then
    raise exception 'Only a payment can be reversed';
  end if;
  if exists(select 1 from public.st_settlements where reverses_settlement_id = s.id) then
    raise exception 'This payment is already reversed';
  end if;

  select * into j from public.st_jobs where id = s.job_id for update;
  if j.status <> 'COMPLETED' or j.review_status <> 'APPROVED' then raise exception 'Only completed, approved cleanings can be changed'; end if;

  -- Settlement rows are immutable (update and delete are blocked), so the reversal is inserted
  -- as a new row that points back to the original. The unique index allows one reversal per payment.
  rev_kind := case when s.kind = 'CLIENT_PAYMENT' then 'CLIENT_REFUND' else 'CLEANER_RETURN' end;
  insert into public.st_settlements(job_id, kind, amount_cents, note, request_id, created_by_user_id, reverses_settlement_id)
  values (s.job_id, rev_kind, s.amount_cents, 'Reversal of payment #' || s.id || ': ' || reason,
          'reverse:' || s.id, p_actor_id, s.id)
  returning * into r;
  if s.kind = 'CLIENT_PAYMENT' then
    update public.st_jobs set financial_status = case when
      (select coalesce(sum(case kind when 'CLIENT_PAYMENT' then amount_cents when 'CLIENT_REFUND' then -amount_cents else 0 end), 0)
         from public.st_settlements where job_id = s.job_id) >= round((j.client_price + j.extra_revenue) * 100)
      then 'PAID' else 'INVOICED' end
    where id = s.job_id;
  end if;
  insert into public.st_job_events(job_id, user_id, event_type, payload_json)
  values (s.job_id, p_actor_id, 'PAYMENT_REVERSED',
          jsonb_build_object('settlementId', s.id, 'reversalId', r.id, 'amountCents', s.amount_cents, 'reason', reason));
  return r;
end
$fn$;

create or replace function public.st_correct_settlement(p_actor_id bigint, p_settlement_id bigint, p_amount_cents bigint, p_reason text, p_request_id text)
returns public.st_settlements
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  s public.st_settlements%rowtype;
  n public.st_settlements%rowtype;
  reason text;
begin
  if not exists(select 1 from public.st_users where id = p_actor_id and active and role = 'ADMIN') then
    raise exception 'Forbidden';
  end if;
  reason := left(btrim(coalesce(p_reason, '')), 300);
  if length(reason) = 0 then raise exception 'A reason is required'; end if;
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

  perform public.st_reverse_settlement(p_actor_id, s.id, 'Correction: ' || reason);
  n := public.st_record_settlement(p_actor_id, s.job_id, s.kind, p_amount_cents,
        'Corrected payment #' || s.id || ': ' || reason, 'correct:' || p_request_id);
  insert into public.st_job_events(job_id, user_id, event_type, payload_json)
  values (s.job_id, p_actor_id, 'PAYMENT_CORRECTED',
          jsonb_build_object('settlementId', s.id, 'newSettlementId', n.id, 'oldAmountCents', s.amount_cents, 'newAmountCents', p_amount_cents, 'reason', reason));
  return n;
end
$fn$;

create or replace function public.st_cancel_manual_job(p_actor_id bigint, p_job_id bigint, p_reason text)
returns public.st_jobs
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  j public.st_jobs%rowtype;
  client_net bigint;
  cleaner_net bigint;
  reason text;
begin
  if not exists(select 1 from public.st_users where id = p_actor_id and active and role = 'ADMIN') then
    raise exception 'Forbidden';
  end if;
  reason := left(btrim(coalesce(p_reason, '')), 300);
  if length(reason) = 0 then raise exception 'A reason is required'; end if;
  select * into j from public.st_jobs where id = p_job_id for update;
  if not found then raise exception 'Cleaning not found'; end if;
  if j.status = 'CANCELLED' then raise exception 'This cleaning is already cancelled'; end if;
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
  values (j.id, p_actor_id, 'MANUAL_CANCELLED', jsonb_build_object('reason', reason));
  return j;
end
$fn$;

revoke all on function public.st_reverse_settlement(bigint, bigint, text) from public, anon, authenticated;
revoke all on function public.st_correct_settlement(bigint, bigint, bigint, text, text) from public, anon, authenticated;
revoke all on function public.st_cancel_manual_job(bigint, bigint, text) from public, anon, authenticated;
grant execute on function public.st_reverse_settlement(bigint, bigint, text) to service_role;
grant execute on function public.st_correct_settlement(bigint, bigint, bigint, text, text) to service_role;
grant execute on function public.st_cancel_manual_job(bigint, bigint, text) to service_role;
