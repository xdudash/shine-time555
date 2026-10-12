-- Stage 1: run the dispatch worker every 15 minutes.
-- Run this once in Supabase → SQL Editor AFTER the stage 1 migration is applied.
-- It expires past jobs, warns managers 24 h before an unassigned cleaning and opens
-- rescue 3 h before it. Safe to re-run: the old schedule is removed first.

select cron.unschedule(jobid) from cron.job where jobname = 'shine-time-dispatch';
select cron.schedule('shine-time-dispatch', '*/15 * * * *', 'select public.st_dispatch_tick()');

-- Check it is registered:
select jobname, schedule, active from cron.job order by jobname;
