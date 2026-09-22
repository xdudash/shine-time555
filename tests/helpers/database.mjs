import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

// Actual PostgreSQL engine, with only Supabase-owned schemas bootstrapped.
// PGlite serializes sessions: these tests do NOT prove production lock contention.
export async function createDatabase({ changes = true, database = null } = {}) {
  const db = database || new PGlite({ extensions: { pgcrypto } });
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema storage;
    create table auth.users(id uuid primary key, email text);
    create function auth.uid() returns uuid language sql stable as
      $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,metadata jsonb,owner uuid);
    create publication supabase_realtime;
  `);
  await db.exec(await readFile(resolve('supabase/hostinger_schema.sql'), 'utf8'));
  for (const name of (await readdir('supabase/migrations')).sort()) {
    if (name <= '20260902094500_manager_assignment_audit_index.sql' && name !== '20260901081027_shine_time_v4_hostinger.sql') {
      await db.exec(await readFile(resolve('supabase/migrations',name),'utf8'));
    }
  }
  if (changes) {
    for (const name of (await readdir('supabase/migrations')).sort()) {
      if (name > '20260902094500_manager_assignment_audit_index.sql') await db.exec(await readFile(resolve('supabase/migrations',name),'utf8'));
    }
    let files=[]; try { files=await readdir('supabase/changes'); } catch {}
    for (const name of files.filter(n=>n.endsWith('.sql')).sort()) await db.exec(await readFile(resolve('supabase/changes',name),'utf8'));
  }
  return db;
}

export async function seedDatabase(db) {
  await db.exec(`
    insert into auth.users(id,email) values
    ('00000000-0000-4000-8000-000000000001','admin@test.invalid'),
    ('00000000-0000-4000-8000-000000000002','cleaner@test.invalid'),
    ('00000000-0000-4000-8000-000000000003','cleaner2@test.invalid'),
    ('00000000-0000-4000-8000-000000000004','owner@test.invalid'),
    ('00000000-0000-4000-8000-000000000005','manager@test.invalid'),
    ('00000000-0000-4000-8000-000000000006','dispatch@test.invalid');
    insert into st_users(auth_user_id,email,role,full_name) select id,email,
      case email when 'admin@test.invalid' then 'ADMIN' when 'owner@test.invalid' then 'OWNER'
        when 'manager@test.invalid' then 'PROPERTY_MANAGER' when 'dispatch@test.invalid' then 'OPERATIONS_MANAGER' else 'CLEANER' end,
      split_part(email,'@',1) from auth.users order by id;
    insert into st_cleaners(user_id,max_jobs_day) values(2,20),(3,20);
    insert into st_client_accounts(user_id,account_type) values(4,'OWNER'),(5,'PROPERTY_MANAGER');
    insert into st_objects(client_id,code,name,address,checkout_time,deadline_time,duration_minutes,payout,client_price)
      values(1,'TEST-1','Test apartment','Synthetic address','08:00','20:00',60,20,40),
      (1,'TEST-2','Test office','Synthetic address 2','08:00','20:00',60,20,40);
    insert into st_cleaner_availability(cleaner_id,service_date,online,from_time,to_time)
      values(1,current_date+1,true,'08:00','20:00'),(2,current_date+1,true,'08:00','20:00');
  `);
}
