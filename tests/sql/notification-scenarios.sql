\set ON_ERROR_STOP 1
\ir seed.sql
\echo == 1. no subscription and a non-email type: nothing is queued
insert into st_notifications(user_id,type,title,message) values(2,'MARKETPLACE','New cleaning available','TEST-1');
select count(*) as outbox_rows from st_notification_outbox;
\echo == 2. a push subscription makes the same notification queue a push row
select id,user_id,endpoint from st_save_push_subscription(2,jsonb_build_object('endpoint','https://push.example.invalid/aaa','p256dh','BPc1','auth','c2VjcmV0','userAgent','Android Chrome'));
insert into st_notifications(user_id,type,title,message) values(2,'MARKETPLACE','New cleaning available','TEST-1 again');
select channel,status,type,title from st_notification_outbox order by id;
\echo == 3. an email-worthy type queues both channels
insert into st_notifications(user_id,type,title,message) values(2,'RESCUE','Urgent cleaning with bonus','TEST-1 rescue');
select channel,status,type from st_notification_outbox where type='RESCUE' order by channel;
\echo == 4. the person turns push off: only email is queued
select id,notify_push,notify_email from st_set_notification_preferences(2,'{"push":false}'::jsonb);
insert into st_notifications(user_id,type,title,message) values(2,'RESCUE','Urgent cleaning with bonus','TEST-1 second rescue');
select channel,count(*) from st_notification_outbox where type='RESCUE' group by channel order by 1;
select id,notify_push from st_set_notification_preferences(2,'{"push":true}'::jsonb);
\echo == 5. an inactive user gets nothing
update st_users set active=false where id=3;
insert into st_push_subscriptions(user_id,endpoint,p256dh,auth) values(3,'https://push.example.invalid/ccc','BPc3','c2VjcmV0Mw');
insert into st_notifications(user_id,type,title,message) values(3,'RESCUE','Urgent','ignored');
select count(*) as rows_for_inactive from st_notification_outbox where user_id=3;
update st_users set active=true where id=3;
\echo == 6. the worker claims a batch once; a second claim gets nothing
select jsonb_array_length(st_claim_notifications(50)->'rows') as first_claim;
select jsonb_array_length(st_claim_notifications(50)->'rows') as second_claim;
select status,count(*) from st_notification_outbox group by status order by 1;
\echo == 7. a claimed push row carries the subscription and the language
update st_notification_outbox set status='PENDING',attempts=0;
with claim as (select st_claim_notifications(50)->'rows' as rows)
select jsonb_pretty(jsonb_path_query_first(rows,'$[*] ? (@.channel == "PUSH")')) as push_row,
       jsonb_pretty(jsonb_path_query_first(rows,'$[*] ? (@.channel == "EMAIL")')) as email_row from claim;
\echo == 8. reporting: one sent, one failed and retried, one gone endpoint pruned
select jsonb_pretty(st_report_notifications(jsonb_build_object('results',jsonb_build_array(
  jsonb_build_object('id',(select min(id) from st_notification_outbox),'ok',true),
  jsonb_build_object('id',(select max(id) from st_notification_outbox),'ok',false,'error','502 from push service'),
  jsonb_build_object('id',(select min(id) from st_notification_outbox),'ok',true,'goneSubscriptionIds',jsonb_build_array((select id from st_push_subscriptions where endpoint like '%ccc'))))))); 
select status,attempts,left(coalesce(last_error,''),30) as error from st_notification_outbox order by id;
select count(*) as remaining_subscriptions from st_push_subscriptions;
\echo == 9. retry limit: a row that keeps failing ends as FAILED, not forever PENDING
update st_settings set value_json='2' where setting_key='notificationRetryLimit';
update st_notification_outbox set status='PENDING',attempts=0,last_error=null;
select jsonb_array_length(st_claim_notifications(50)->'rows') as claim_1;
select st_report_notifications(jsonb_build_object('results',(select jsonb_agg(jsonb_build_object('id',id,'ok',false,'error','smtp timeout')) from st_notification_outbox)));
select jsonb_array_length(st_claim_notifications(50)->'rows') as claim_2;
select st_report_notifications(jsonb_build_object('results',(select jsonb_agg(jsonb_build_object('id',id,'ok',false,'error','smtp timeout')) from st_notification_outbox)));
select status,attempts,count(*) from st_notification_outbox group by 1,2 order by 1,2;
select jsonb_array_length(st_claim_notifications(50)->'rows') as claim_after_limit;
\echo == 10. a stale SENDING row is picked up again after 10 minutes
update st_settings set value_json='5' where setting_key='notificationRetryLimit';
update st_notification_outbox set status='SENDING',attempts=1,claimed_at=now()-interval '30 minutes';
select jsonb_array_length(st_claim_notifications(50)->'rows') as reclaimed;
\echo == 11. removing a subscription stops push for that browser
select st_delete_push_subscription(2,'https://push.example.invalid/aaa') as removed;
delete from st_notification_outbox;
insert into st_notifications(user_id,type,title,message) values(2,'MARKETPLACE','New cleaning available','after unsubscribe');
select count(*) as outbox_rows_after_unsubscribe from st_notification_outbox;
\echo == 12. the tables are closed to signed-in clients
select tablename,policyname,permissive,roles::text,qual from pg_policies where tablename in ('st_push_subscriptions','st_notification_outbox') order by tablename;
select has_table_privilege('authenticated','st_push_subscriptions','select') as authenticated_can_read_subscriptions,
       has_table_privilege('authenticated','st_notification_outbox','select') as authenticated_can_read_outbox;
