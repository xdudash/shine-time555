insert into auth.users(id,email) values
('00000000-0000-4000-8000-000000000001','admin@test.invalid'),('00000000-0000-4000-8000-000000000002','cleaner@test.invalid'),
('00000000-0000-4000-8000-000000000003','cleaner2@test.invalid'),('00000000-0000-4000-8000-000000000004','owner@test.invalid'),
('00000000-0000-4000-8000-000000000005','manager@test.invalid'),('00000000-0000-4000-8000-000000000006','dispatch@test.invalid');
insert into st_users(auth_user_id,email,role,full_name) select id,email,
  case email when 'admin@test.invalid' then 'ADMIN' when 'owner@test.invalid' then 'OWNER'
    when 'manager@test.invalid' then 'PROPERTY_MANAGER' when 'dispatch@test.invalid' then 'OPERATIONS_MANAGER' else 'CLEANER' end,
  split_part(email,'@',1) from auth.users order by id;
insert into st_cleaners(user_id,max_jobs_day) values(2,20),(3,20);
insert into st_client_accounts(user_id,account_type) values(4,'OWNER'),(5,'PROPERTY_MANAGER');
insert into st_objects(client_id,code,name,address,checkout_time,deadline_time,duration_minutes,payout,client_price,lat,lng)
  values(1,'TEST-1','Test apartment','Synthetic address','08:00','20:00',60,20,40,48.1459,17.1077),(1,'TEST-2','Test office','Addr 2','08:00','20:00',60,20,40,48.15,17.11);
