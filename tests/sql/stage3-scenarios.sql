\set ON_ERROR_STOP 1
\ir seed.sql
\echo == 1. a brand-new person asks for an account and lands inactive
insert into auth.users(id,email) values('00000000-0000-4000-8000-000000000011','newclient@test.invalid');
select jsonb_pretty(st_request_client_account('00000000-0000-4000-8000-000000000011','newclient@test.invalid',
 jsonb_build_object('fullName','Nina New','phone','+421900111222','companyName','Nina stays','city','Bratislava','propertyCount','3','message','Two flats in the old town','language','sk')));
select id,email,role,active from st_users where email='newclient@test.invalid';
select status,company_name,city,property_count from st_account_requests order by id;
\echo == 2. the staff were told
select u.role,n.type,n.title from st_notifications n join st_users u on u.id=n.user_id where n.type='ACCOUNT_REQUEST' order by u.id;
\echo == 3. asking twice does not queue twice
select jsonb_pretty(st_request_client_account('00000000-0000-4000-8000-000000000011','newclient@test.invalid',jsonb_build_object('fullName','Nina New')));
select count(*) as requests from st_account_requests;
select count(*) as users from st_users where email='newclient@test.invalid';
\echo == 4. a request without a name is refused
insert into auth.users(id,email) values('00000000-0000-4000-8000-000000000012','nameless@test.invalid');
do $$begin perform st_request_client_account('00000000-0000-4000-8000-000000000012','nameless@test.invalid','{}'::jsonb); exception when others then raise notice 'refused: %',sqlerrm; end$$;
\echo == 5. nobody but an administrator decides
do $$begin perform st_decide_client_account(6,1,true,null); exception when others then raise notice 'ops manager refused: %',sqlerrm; end$$;
do $$begin perform st_decide_client_account(4,1,true,null); exception when others then raise notice 'owner refused: %',sqlerrm; end$$;
do $$begin perform st_account_requests_list(6,'PENDING'); exception when others then raise notice 'list refused: %',sqlerrm; end$$;
\echo == 6. approving opens the account and creates the client account
select jsonb_pretty(st_decide_client_account(1,1,true,'Checked the company register'));
select id,email,role,active from st_users where email='newclient@test.invalid';
select ca.id,ca.account_type,ca.company_name from st_client_accounts ca join st_users u on u.id=ca.user_id where u.email='newclient@test.invalid';
select type,title from st_notifications where user_id=(select id from st_users where email='newclient@test.invalid');
\echo == 7. the same request cannot be decided twice
do $$begin perform st_decide_client_account(1,1,false,'changed my mind'); exception when others then raise notice 'refused: %',sqlerrm; end$$;
\echo == 8. an approved client can now book their own property, like any owner
insert into st_objects(client_id,code,name,address,checkout_time,deadline_time,duration_minutes,payout,client_price)
 values((select ca.id from st_client_accounts ca join st_users u on u.id=ca.user_id where u.email='newclient@test.invalid'),
   'NINA-1','Old town flat','Hlavna 1','10:00','20:00',60,20,40);
select j.id,j.status,o.code from st_create_job((select id from st_users where email='newclient@test.invalid'),
 jsonb_build_object('objectId',(select id from st_objects where code='NINA-1'),'serviceDate',((now() at time zone 'Europe/Bratislava')::date+1)::text)) j
 join st_objects o on o.id=j.object_id;
-- and still not somebody else's property
do $$begin perform st_create_job((select id from st_users where email='newclient@test.invalid'),jsonb_build_object('objectId',1,'serviceDate',((now() at time zone 'Europe/Bratislava')::date+3)::text)); exception when others then raise notice 'another owner property refused: %',sqlerrm; end$$;
\echo == 9. rejecting keeps the account closed, with the reason on record
insert into auth.users(id,email) values('00000000-0000-4000-8000-000000000013','spam@test.invalid');
select st_request_client_account('00000000-0000-4000-8000-000000000013','spam@test.invalid',jsonb_build_object('fullName','Spam Sender'))->>'status' as status;
select jsonb_pretty(st_decide_client_account(1,(select r.id from st_account_requests r join st_users u on u.id=r.user_id where u.email='spam@test.invalid'),false,'No properties, looks like spam'));
select u.active,r.status,r.decision_note from st_account_requests r join st_users u on u.id=r.user_id where u.email='spam@test.invalid';
do $$begin perform st_create_job((select id from st_users where email='spam@test.invalid'),jsonb_build_object('objectId',(select id from st_objects where code='NINA-1'),'serviceDate',((now() at time zone 'Europe/Bratislava')::date+2)::text)); exception when others then raise notice 'rejected account refused: %',sqlerrm; end$$;
\echo == 10. the list shows both decisions to the administrator
select jsonb_array_length(st_account_requests_list(1,'ALL')->'requests') as all_requests,
       jsonb_array_length(st_account_requests_list(1,'PENDING')->'requests') as pending;
\echo == 11. registration can be closed without a deployment
update st_settings set value_json='false' where setting_key='selfRegistrationOpen';
insert into auth.users(id,email) values('00000000-0000-4000-8000-000000000014','late@test.invalid');
do $$begin perform st_request_client_account('00000000-0000-4000-8000-000000000014','late@test.invalid',jsonb_build_object('fullName','Late Lucy')); exception when others then raise notice 'refused: %',sqlerrm; end$$;
update st_settings set value_json='true' where setting_key='selfRegistrationOpen';
\echo == 12. the table and the functions stay closed to signed-in clients
select has_table_privilege('authenticated','st_account_requests','select') as can_read,
       has_function_privilege('authenticated','st_request_client_account(uuid,text,jsonb)','execute') as can_request,
       has_function_privilege('authenticated','st_decide_client_account(bigint,bigint,boolean,text)','execute') as can_decide;
