-- Phase 2 integrity hardening.
-- The service-role API remains the only caller of sensitive command functions.
-- These guards make important invariants fail-closed even if application code regresses.

-- Idempotency keys are deliberately bounded to the same 96-character contract
-- used by the Edge Function. This closes the gap where SQL previously allowed 200.
create or replace function public.st_validate_job_command_request_id()
returns trigger
language plpgsql
as $$
begin
  if new.request_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,95}$' then
    raise exception 'Invalid request id';
  end if;
  return new;
end;
$$;

drop trigger if exists st_job_command_request_id_guard on public.st_job_command_requests;
create trigger st_job_command_request_id_guard
before insert or update on public.st_job_command_requests
for each row execute function public.st_validate_job_command_request_id();

revoke all on function public.st_validate_job_command_request_id() from public, anon, authenticated;

-- Money on a job is never allowed to become negative. NOT VALID makes this
-- safe to deploy into an environment that may contain historical bad rows;
-- new writes are still checked immediately. Validate later after cleanup.
do $$
begin
  if not exists (select 1 from pg_constraint where conname='st_jobs_nonnegative_finance_ck') then
    alter table public.st_jobs add constraint st_jobs_nonnegative_finance_ck
      check (payout >= 0 and client_price >= 0 and bonus >= 0 and extra_revenue >= 0 and extra_cost >= 0) not valid;
  end if;
end $$;

-- Service-window integrity must hold regardless of which trusted backend path
-- performs the mutation. NOT VALID avoids blocking rollout on legacy rows.
do $$
begin
  if not exists (select 1 from pg_constraint where conname='st_jobs_service_window_ck') then
    alter table public.st_jobs add constraint st_jobs_service_window_ck
      check (
        earliest_start < deadline
        and duration_minutes between 15 and 1440
        and service_date + earliest_start + make_interval(mins => duration_minutes) <= service_date + deadline
        and (planned_start is null or (planned_start >= earliest_start and planned_start < deadline
          and service_date + planned_start + make_interval(mins => duration_minutes) <= service_date + deadline))
      ) not valid;
  end if;
end $$;

-- Settlement rows are immutable and already bounded by the finance command.
-- Add an explicit domain check so direct trusted inserts cannot bypass it.
do $$
begin
  if not exists (select 1 from pg_constraint where conname='st_settlements_amount_ck') then
    alter table public.st_settlements add constraint st_settlements_amount_ck
      check (amount_cents between 1 and 100000000);
  end if;
end $$;

create index if not exists st_job_command_requests_job_idx
  on public.st_job_command_requests(job_id, created_at desc);

create index if not exists st_job_command_requests_request_idx
  on public.st_job_command_requests(actor_id, request_id);
