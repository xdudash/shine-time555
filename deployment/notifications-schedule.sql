-- Stage 1, fix 5: let the database ask st-api to drain the notification outbox.
-- Run this once in Supabase → SQL Editor AFTER 20261012120000_notification_delivery.sql
-- is applied and the function secrets are set. Safe to re-run.
--
-- Fill in the two values below first:
--   <SERVICE_ROLE_KEY>  Project settings → API. On this project that is the
--                       secret key (sb_secret_…), not a JWT. Because it is not
--                       a JWT, the platform's verify_jwt gate cannot accept it,
--                       which is why st-api runs with verify_jwt = false
--                       (supabase/config.toml) and authenticates callers
--                       itself. Do not turn verify_jwt back on: the scheduled
--                       call below would start failing with 401.
--   <WORKER_SECRET>     the same value you set as ST_WORKER_SECRET in the
--                       Edge Function secrets. This is what actually protects
--                       the route, so treat it like a password.
-- Nothing in this repository may contain either value: keep this file as the
-- template it is and paste the filled-in version straight into the SQL editor.

create extension if not exists pg_net with schema extensions;

select cron.unschedule(jobid) from cron.job where jobname = 'shine-time-notifications';
select cron.schedule('shine-time-notifications', '* * * * *', $$
  select net.http_post(
    url := 'https://qbbtroiqioufuucrqair.supabase.co/functions/v1/st-api',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'Authorization','Bearer <SERVICE_ROLE_KEY>',
      'x-st-worker-secret','<WORKER_SECRET>'),
    body := jsonb_build_object('route','dispatch/outbox','method','POST','body','{}'::jsonb),
    timeout_milliseconds := 20000);
$$);

-- Check it is registered and that the calls are coming back 200:
select jobname, schedule, active from cron.job order by jobname;
select status, count(*) from public.st_notification_outbox group by status order by 1;
select id, status_code, left(coalesce(content,''),200) as body, created
  from net._http_response order by id desc limit 5;
