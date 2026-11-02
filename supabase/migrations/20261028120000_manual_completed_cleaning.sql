-- Manual entry of a cleaning that was done but is missing from the system.
-- The job is recorded as completed and already approved, so it joins the monthly
-- reconciliation at once and carries an audit event; it cannot duplicate a cleaning
-- already booked for the same property and date.
-- Manual payments need no new function: they go through the existing batch ledger.

create or replace function public.st_create_manual_completed_job(p_actor_id bigint, p_body jsonb)
returns public.st_jobs
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  u st_users%rowtype;
  o st_objects%rowtype;
  j st_jobs%rowtype;
  d date;
  today_local date := (now() at time zone 'Europe/Bratislava')::date;
  client_price numeric;
  payout numeric;
  cleaner_id bigint;
begin
  select * into strict u from st_users where id = p_actor_id and active;
  if u.role <> 'ADMIN' then raise exception 'Forbidden'; end if;

  select * into o from st_objects
   where id = (p_body->>'objectId')::bigint and active and approval_status = 'APPROVED';
  if not found then raise exception 'Property is not approved for booking'; end if;

  d := (p_body->>'serviceDate')::date;
  if d is null or d > today_local or d < today_local - 366 then
    raise exception 'Enter a past service date (up to one year back)';
  end if;

  client_price := (p_body->>'clientPrice')::numeric;
  payout := (p_body->>'payout')::numeric;
  if client_price is null or client_price < 0 or client_price > 100000 then
    raise exception 'Enter a valid client price';
  end if;
  if payout is null or payout < 0 or payout > 100000 then
    raise exception 'Enter a valid cleaner payout';
  end if;

  cleaner_id := (p_body->>'cleanerId')::bigint;
  if cleaner_id is null or not exists (
    select 1 from st_cleaners c join st_users cu on cu.id = c.user_id
     where c.id = cleaner_id and cu.active
  ) then
    raise exception 'Choose the cleaner who did the work';
  end if;

  perform pg_advisory_xact_lock(hashtext(d::text));
  if exists (
    select 1 from st_jobs
     where object_id = o.id and service_date = d and status not in ('CANCELLED', 'EXPIRED')
  ) then
    raise exception 'A cleaning is already recorded for this property on that date';
  end if;

  insert into st_jobs(
    object_id, client_id, service_date, earliest_start, deadline, duration_minutes,
    payout, client_price, bonus, planned_start, eta, booking_source, created_by_user_id,
    status, marketplace_visible, client_note, assigned_cleaner_id, completed_at,
    completion_counted, review_status, review_version, reviewed_at, reviewed_by_user_id, review_note
  ) values (
    o.id, o.client_id, d, o.checkout_time, o.deadline_time, o.duration_minutes,
    payout, client_price, 0, null, null, 'ADMIN', u.id,
    'COMPLETED', false, null, cleaner_id,
    (d + coalesce(o.deadline_time, time '18:00')) at time zone 'Europe/Bratislava',
    true, 'APPROVED', 0, now(), u.id, 'Entered manually'
  ) returning * into j;

  insert into st_job_events(job_id, user_id, event_type, payload_json)
  values (j.id, u.id, 'MANUAL_ENTRY', jsonb_build_object('clientPrice', client_price, 'payout', payout));

  return j;
end
$fn$;

revoke all on function public.st_create_manual_completed_job(bigint, jsonb) from public, anon, authenticated;
grant execute on function public.st_create_manual_completed_job(bigint, jsonb) to service_role;

-- Manual payment for a whole month and party, possibly partial.
-- The amount is spread over the oldest outstanding cleanings of that party in that month;
-- each row goes through st_record_settlement, so balances, roles and property scope are
-- checked exactly as for any other payment. A payment larger than the outstanding balance
-- is rejected and nothing is written. Request ids are idempotent.
create or replace function public.st_record_manual_monthly_payment(
  p_actor_id bigint, p_month text, p_side text, p_party_id bigint,
  p_amount_cents bigint, p_note text, p_request_id text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  d date;
  v_kind text;
  v_refund text;
  note text;
  payload jsonb;
  old st_settlement_batches%rowtype;
  row_ record;
  left_cents bigint;
  take bigint;
  n integer := 0;
  total bigint := 0;
  answer jsonb;
begin
  if not exists(select 1 from st_users where id = p_actor_id and active and role in ('ADMIN','OPERATIONS_MANAGER','PROPERTY_MANAGER')) then
    raise exception 'Forbidden';
  end if;
  if p_month is null or p_month !~ '^\d{4}-(0[1-9]|1[0-2])$' or p_side is null or p_side not in ('CLIENT','CLEANER') or p_party_id is null then
    raise exception 'Invalid period or counterparty';
  end if;
  if p_amount_cents is null or p_amount_cents <= 0 or p_amount_cents > 100000000 then
    raise exception 'Enter a positive amount';
  end if;
  note := left(btrim(coalesce(p_note, '')), 300);
  if length(note) = 0 then raise exception 'A reference is required for a manual payment'; end if;
  if length(coalesce(p_request_id, '')) not between 1 and 100 then raise exception 'Invalid request id'; end if;

  payload := jsonb_build_object('month', p_month, 'side', p_side, 'party', p_party_id, 'amountCents', p_amount_cents, 'note', note);
  perform pg_advisory_xact_lock(hashtext('manual-monthly:' || p_actor_id::text || ':' || p_request_id));
  select * into old from st_settlement_batches where actor_id = p_actor_id and request_id = 'manual:' || p_request_id;
  if found then
    if old.payload <> payload then raise exception 'Request id already used'; end if;
    return old.result;
  end if;

  d := (p_month || '-01')::date;
  v_kind := case when p_side = 'CLIENT' then 'CLIENT_PAYMENT' else 'CLEANER_PAYOUT' end;
  v_refund := case when p_side = 'CLIENT' then 'CLIENT_REFUND' else 'CLEANER_RETURN' end;
  left_cents := p_amount_cents;

  for row_ in
    select x.id, x.owed from (
      select j.id, j.service_date,
        (case when p_side = 'CLIENT' then round((j.client_price + j.extra_revenue) * 100) else round((j.payout + j.bonus) * 100) end)::bigint
        - coalesce((select sum(case when s.kind = v_kind then s.amount_cents when s.kind = v_refund then -s.amount_cents else 0 end)
                      from st_settlements s where s.job_id = j.id), 0) as owed
      from st_jobs j
      where j.status = 'COMPLETED' and j.review_status = 'APPROVED'
        and j.service_date >= d and j.service_date < d + interval '1 month'
        and (case when p_side = 'CLIENT' then j.client_id else j.assigned_cleaner_id end) = p_party_id
    ) x
    where x.owed > 0
    order by x.service_date, x.id
  loop
    exit when left_cents <= 0;
    take := least(row_.owed, left_cents);
    perform st_record_settlement(p_actor_id, row_.id, v_kind, take, note, 'manual:' || p_request_id || ':' || row_.id);
    left_cents := left_cents - take;
    total := total + take;
    n := n + 1;
  end loop;

  if left_cents > 0 then raise exception 'Amount exceeds outstanding balance'; end if;

  answer := jsonb_build_object('count', n, 'amountCents', total);
  insert into st_settlement_batches(actor_id, request_id, payload, result)
  values (p_actor_id, 'manual:' || p_request_id, payload, answer);
  return answer;
end
$fn$;

revoke all on function public.st_record_manual_monthly_payment(bigint, text, text, bigint, bigint, text, text) from public, anon, authenticated;
grant execute on function public.st_record_manual_monthly_payment(bigint, text, text, bigint, bigint, text, text) to service_role;
