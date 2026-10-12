\set ON_ERROR_STOP 1
\ir seed.sql
\echo == 1. client books a window (no auto-assign)
select id,status,earliest_start,deadline,planned_start,assigned_cleaner_id,marketplace_visible,client_note
 from st_create_job(4,jsonb_build_object('objectId',1,'serviceDate',((now() at time zone 'Europe/Bratislava')::date+1)::text,'earliestStart','10:00','deadline','16:00','note','Guests at 16:00, change all linen'));
\echo == 2. cleaners and staff were notified
select u.role,n.type,n.title from st_notifications n join st_users u on u.id=n.user_id order by u.id;
\echo == 3. cleaner takes it with a chosen start
select id,status,planned_start,eta,assigned_cleaner_id,marketplace_visible from st_job_command(2,1,'accept',jsonb_build_object('plannedStart','13:00'),'req-accept-1-00000001');
\echo == 4. replay of the same request id is a no-op
select id,status,planned_start from st_job_command(2,1,'accept',jsonb_build_object('plannedStart','13:00'),'req-accept-1-00000001');
\echo == 5. second cleaner cannot take it
do $$begin perform st_job_command(3,1,'accept','{}'::jsonb,'req-accept-2-00000001'); raise exception 'SHOULD NOT REACH'; exception when others then raise notice 'refused: %',sqlerrm; end$$;
\echo == 6. start outside the window is refused
select id,status from st_job_command(2,1,'cancel',jsonb_build_object('reason','test'),'req-rel-1-00000001');
do $$begin perform st_job_command(2,1,'accept',jsonb_build_object('plannedStart','09:00'),'req-accept-3-00000001'); exception when others then raise notice 'refused: %',sqlerrm; end$$;
do $$begin perform st_job_command(2,1,'accept',jsonb_build_object('plannedStart','15:30'),'req-accept-4-00000001'); exception when others then raise notice 'refused: %',sqlerrm; end$$;
\echo == 7. GPS check-in outside the radius is recorded, not blocked
select id,status,planned_start from st_job_command(2,1,'accept',jsonb_build_object('plannedStart','13:00'),'req-accept-5-00000001');
select id,status from st_job_command(2,1,'status',jsonb_build_object('status','EN_ROUTE'),'req-s1-00000001');
select id,status,checkin_distance_m from st_job_command(2,1,'status',jsonb_build_object('status','ARRIVED','lat',48.2459,'lng',17.1077),'req-s2-00000001');
select event_type,payload_json->>'distanceM' as distance_m,payload_json->>'radiusM' as radius_m from st_job_events where event_type='CHECKIN_OUTSIDE_RADIUS';
\echo == 8. client cannot cancel once the cleaner is on site
do $$begin perform st_job_command(4,1,'cancel','{}'::jsonb,'req-cc-1-00000001'); exception when others then raise notice 'refused: %',sqlerrm; end$$;
\echo == 9. complete -> review gate
select id,status from st_job_command(2,1,'status',jsonb_build_object('status','CLEANING'),'req-s3-00000001');
update st_job_checklist set completed=true where job_id=1;
insert into st_job_photos(job_id,cleaner_id,category,storage_path,file_name,mime)
 select distinct 1,1,c.photo_category,'synthetic/'||c.photo_category||'.jpg',c.photo_category||'.jpg','image/jpeg' from st_job_checklist c where c.job_id=1 and c.photo_required;
select id,status,review_status from st_job_command(2,1,'complete','{}'::jsonb,'req-done-00000001');
\echo == 10. rebooking the same property and day after a cancel
select id,status from st_create_job(1,jsonb_build_object('objectId',2,'serviceDate',((now() at time zone 'Europe/Bratislava')::date+1)::text,'earliestStart','10:00','deadline','16:00'));
select id,status from st_job_command(1,2,'cancel',jsonb_build_object('reason','client changed plans'),'req-adm-cancel-00000001');
select id,status from st_create_job(1,jsonb_build_object('objectId',2,'serviceDate',((now() at time zone 'Europe/Bratislava')::date+1)::text,'earliestStart','10:00','deadline','16:00'));
\echo == 11. late release opens rescue and costs reliability
select id,status from st_job_command(2,3,'accept',jsonb_build_object('plannedStart','10:00'),'req-a-3-00000001');
update st_jobs set service_date=(now() at time zone 'Europe/Bratislava')::date, planned_start=((now() at time zone 'Europe/Bratislava')+interval '30 minutes')::time, earliest_start='00:00', deadline='23:59' where id=3;
select id,status,rescue_state,bonus,assigned_cleaner_id from st_job_command(2,3,'cancel',jsonb_build_object('reason','sick'),'req-late-rel-00000001');
select id,reliability_score from st_cleaners where id=1;
\echo == 12. dispatch tick: expire, escalate, rescue
insert into st_jobs(object_id,client_id,service_date,earliest_start,deadline,duration_minutes,payout,client_price,status,marketplace_visible,booking_source)
 values(1,1,(now() at time zone 'Europe/Bratislava')::date-1,'08:00','12:00',60,20,40,'UNASSIGNED',true,'EXPIRE-CASE'),
       (2,1,(now() at time zone 'Europe/Bratislava')::date+1,'02:00','23:00',60,20,40,'UNASSIGNED',true,'ESCALATE-CASE'),
       (1,1,(now() at time zone 'Europe/Bratislava')::date,((now() at time zone 'Europe/Bratislava')+interval '2 hours')::time,'23:59',60,20,40,'UNASSIGNED',true,'RESCUE-CASE');
select public.st_dispatch_tick();
select booking_source,status,rescue_state,bonus,expired_at is not null as expired,escalated_at is not null as escalated
 from st_jobs where booking_source like '%-CASE' order by booking_source;
select type,title from st_notifications where user_id=1 order by id desc limit 3;
\echo == 13. property-manager report: client amounts, no payout and no margin
insert into st_manager_properties(manager_client_id,object_id) values(2,1);
update st_jobs set review_status='APPROVED' where id=1;
select jsonb_pretty(st_settlement_report(5,to_char((now() at time zone 'Europe/Bratislava')::date+1,'YYYY-MM')));
\echo == 14. the same month for the admin, for comparison
select jsonb_pretty(st_settlement_report(1,to_char((now() at time zone 'Europe/Bratislava')::date+1,'YYYY-MM'))->'summary');
