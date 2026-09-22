-- Run only after migrations and staging acceptance. Does not run the worker now.
-- Supabase Cron: https://supabase.com/docs/guides/cron/quickstart
create extension if not exists pg_cron;
select cron.schedule('shine-time-recurring','15 2 * * *','select public.st_run_recurring(30)');
-- Disable without deleting schedules or jobs:
-- select cron.unschedule('shine-time-recurring');
