\set ON_ERROR_STOP 1
\ir seed.sql
-- A finished cleaning for the owner's property, cleaned by cleaner 1.
insert into st_jobs(object_id,client_id,service_date,earliest_start,deadline,duration_minutes,payout,client_price,bonus,status,review_status,assigned_cleaner_id,completed_at,actual_start)
 values(1,1,(now() at time zone 'Europe/Bratislava')::date,'10:00','20:00',60,20,40,0,'COMPLETED','APPROVED',1,now(),now()-interval '1 hour');
\echo == 1. only the client side can rate, and only a finished cleaning
do $$begin perform st_submit_job_feedback(2,1,'{"rating":5}'::jsonb); exception when others then raise notice 'cleaner refused: %',sqlerrm; end$$;
do $$begin perform st_submit_job_feedback(1,1,'{"rating":5}'::jsonb); exception when others then raise notice 'admin refused: %',sqlerrm; end$$;
insert into st_jobs(object_id,client_id,service_date,earliest_start,deadline,duration_minutes,payout,client_price,status,assigned_cleaner_id)
 values(2,1,(now() at time zone 'Europe/Bratislava')::date+1,'10:00','20:00',60,20,40,'ACCEPTED',1);
do $$begin perform st_submit_job_feedback(4,2,'{"rating":5}'::jsonb); exception when others then raise notice 'unfinished refused: %',sqlerrm; end$$;
\echo == 2. the owner rates it and the cleaner rating follows
select id,job_id,rating,complaint,comment from st_submit_job_feedback(4,1,'{"rating":4,"comment":"Clean, a bit late"}'::jsonb);
select id,rating from st_cleaners where id=1;
\echo == 3. a correction inside the window updates the same row, not a second one
select id,rating,comment from st_submit_job_feedback(4,1,'{"rating":5,"comment":"Changed my mind, it was fine"}'::jsonb);
select count(*) as feedback_rows from st_job_feedback;
select id,rating from st_cleaners where id=1;
\echo == 4. a bad rating out of range is refused, and a complaint needs words
do $$begin perform st_submit_job_feedback(4,1,'{"rating":9}'::jsonb); exception when others then raise notice 'refused: %',sqlerrm; end$$;
do $$begin perform st_submit_job_feedback(4,1,'{"rating":1,"complaint":true}'::jsonb); exception when others then raise notice 'refused: %',sqlerrm; end$$;
\echo == 5. a complaint opens an issue for operations and notifies staff
select rating,complaint,issue_id is not null as issue_opened from st_submit_job_feedback(4,1,'{"rating":1,"complaint":true,"comment":"Bathroom was not cleaned"}'::jsonb);
select type,priority,status,left(description,30) as description from st_issues where job_id=1;
select u.role,n.type,n.title from st_notifications n join st_users u on u.id=n.user_id where n.type in ('COMPLAINT','LOW_RATING') order by u.role,n.type;
select event_type from st_job_events where job_id=1 and event_type in ('CLIENT_RATED','CLIENT_COMPLAINT') order by id;
\echo == 6. once the window closes the cleaning can no longer be rated
update st_settings set value_json='1' where setting_key='feedbackWindowDays';
update st_jobs set completed_at=now()-interval '3 days' where id=1;
do $$begin perform st_submit_job_feedback(4,1,'{"rating":3}'::jsonb); exception when others then raise notice 'refused: %',sqlerrm; end$$;
update st_settings set value_json='14' where setting_key='feedbackWindowDays';
\echo == 7. another owner cannot rate someone else cleaning
insert into st_client_accounts(user_id,account_type) values(3,'OWNER');
update st_users set role='OWNER' where id=3;
do $$begin perform st_submit_job_feedback(3,1,'{"rating":1}'::jsonb); exception when others then raise notice 'refused: %',sqlerrm; end$$;
update st_users set role='CLEANER' where id=3;
\echo == 8. the client can change the note until the cleaner arrives
select id,client_note from st_update_booking_note(4,2,'Guests arrive at 16:00, change all linen');
select type,title from st_notifications where type='NOTE_UPDATED';
select id from st_job_command(2,2,'status',jsonb_build_object('status','EN_ROUTE'),'note-test-000001');
select id,client_note from st_update_booking_note(4,2,'Still fine to change while on the way');
select id from st_job_command(2,2,'status',jsonb_build_object('status','ARRIVED','lat',48.1459,'lng',17.1077),'note-test-000002');
do $$begin perform st_update_booking_note(4,2,'Too late now'); exception when others then raise notice 'refused: %',sqlerrm; end$$;
select id,client_note from st_update_booking_note(1,2,'Operations can still fix it');
\echo == 9. recurring bookings the client owns
select jsonb_pretty(st_client_recurring(4));
select id,object_id,weekdays,planned_start,active from st_client_recurring_save(4,'{"objectId":1,"weekdays":[1,3,5],"plannedStart":"11:00"}'::jsonb);
select jsonb_array_length(st_client_recurring(4)->'schedules') as schedules_for_owner;
select jsonb_array_length(st_client_recurring(5)->'schedules') as schedules_for_unlinked_manager;
\echo == 10. a schedule is paused, corrected, and cannot be moved to another property
select id,active from st_client_recurring_save(4,jsonb_build_object('id',(select max(id) from st_recurring),'objectId',1,'weekdays','[2,4]'::jsonb,'plannedStart','12:00','active',false));
do $$begin perform st_client_recurring_save(4,jsonb_build_object('id',(select max(id) from st_recurring),'objectId',2,'weekdays','[2]'::jsonb)); exception when others then raise notice 'refused: %',sqlerrm; end$$;
do $$begin perform st_client_recurring_save(4,'{"objectId":1,"weekdays":[]}'::jsonb); exception when others then raise notice 'refused: %',sqlerrm; end$$;
do $$begin perform st_client_recurring_save(4,'{"objectId":1,"weekdays":[1],"plannedStart":"23:00"}'::jsonb); exception when others then raise notice 'refused: %',sqlerrm; end$$;
\echo == 11. a schedule that already produced cleanings is switched off, not deleted
update st_jobs set recurring_id=(select max(id) from st_recurring) where id=2;
select jsonb_pretty(st_client_recurring_delete(4,(select max(id) from st_recurring)));
select id,active from st_recurring;
select id,status,recurring_id from st_jobs where id=2;
\echo == 11b. an unused schedule is removed outright
select id from st_client_recurring_save(4,'{"objectId":1,"weekdays":[6],"plannedStart":"10:30"}'::jsonb);
select jsonb_pretty(st_client_recurring_delete(4,(select max(id) from st_recurring)));
select count(*) as schedules_left from st_recurring;
do $$begin perform st_client_recurring_delete(4,999999); exception when others then raise notice 'refused: %',sqlerrm; end$$;
\echo == 12. the cleaner earnings are answered by the database
insert into st_jobs(object_id,client_id,service_date,earliest_start,deadline,duration_minutes,payout,client_price,bonus,status,review_status,assigned_cleaner_id,completed_at)
 values(2,1,(now() at time zone 'Europe/Bratislava')::date,'10:00','20:00',60,25,50,6,'COMPLETED','PENDING',1,now());
select st_record_settlement(1,1,'CLEANER_PAYOUT',1500,'Partial payout','earn-test-00000001');
select jsonb_pretty(st_cleaner_earnings(2));
do $$begin perform st_cleaner_earnings(4); exception when others then raise notice 'client refused: %',sqlerrm; end$$;
\echo == 13. the tables and functions stay closed to signed-in clients
select has_table_privilege('authenticated','st_job_feedback','select') as can_read_feedback,
       has_function_privilege('authenticated','public.st_submit_job_feedback(bigint,bigint,jsonb)','execute') as can_call_feedback,
       has_function_privilege('authenticated','public.st_cleaner_earnings(bigint)','execute') as can_call_earnings;
