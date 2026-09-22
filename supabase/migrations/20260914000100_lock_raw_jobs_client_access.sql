-- Security hardening: authenticated browser clients must not read raw job rows.
-- The application exposes cleaner job data through st-api instead.

alter table if exists public.st_jobs enable row level security;

revoke all on table public.st_jobs from anon;
revoke all on table public.st_jobs from authenticated;

-- Keep the table available to trusted server-side operations (service_role).
grant all on table public.st_jobs to service_role;

-- Explicitly remove any pre-existing authenticated SELECT policy that could
-- expose raw jobs directly. Policies are additive, so dropping the broad
-- policy is required rather than relying on a new restrictive policy.
drop policy if exists "authenticated can read jobs" on public.st_jobs;
drop policy if exists "Authenticated users can read jobs" on public.st_jobs;
drop policy if exists "Users can read jobs" on public.st_jobs;
drop policy if exists "users_can_read_jobs" on public.st_jobs;
drop policy if exists "cleaners_can_read_jobs" on public.st_jobs;
drop policy if exists "cleaner_can_read_jobs" on public.st_jobs;
drop policy if exists "job_select_authenticated" on public.st_jobs;

-- No authenticated SELECT policy is intentionally created here.
-- All browser job reads must go through the authenticated st-api function.
