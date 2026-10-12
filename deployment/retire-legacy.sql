-- Stage 3, fixes 27 and 28: retire the imported prototype.
--
-- Run this in Supabase → SQL Editor, in this order, and read section 0 first.
-- It is deliberately NOT a migration: it drops things, so it is a one-time
-- production action you perform with the output in front of you.
--
-- Checked against production on 2026-10-12 before this file was written:
--   cleanings, cleaning_assignments, cleaning_events, cleaning_media,
--   properties, property_access, property_instructions, expenses, payouts,
--   organization_members      0 rows
--   organizations             1 row  (the bootstrap row of 2026-08-31)
--   profiles                  4 rows, last written 2026-10-01
--
-- The four profile rows are the trap. `profiles` is still being written,
-- not by the application but by a trigger on auth.users:
--
--   trigger on_auth_user_created on auth.users
--     → private.handle_new_user() → insert into public.profiles(id, full_name)
--
-- So dropping `profiles` first would break EVERY new sign-up, including the
-- client self-registration of this stage. The trigger goes first, the tables
-- after. The application's own user table is public.st_users and has never
-- depended on `profiles`.

-- 0. Confirm nothing changed since the check above. Expect 0 rows everywhere
--    except organizations (1) and profiles (one row per auth user).
select 'cleanings' t, count(*) from cleanings
union all select 'cleaning_assignments', count(*) from cleaning_assignments
union all select 'cleaning_events', count(*) from cleaning_events
union all select 'cleaning_media', count(*) from cleaning_media
union all select 'properties', count(*) from properties
union all select 'property_access', count(*) from property_access
union all select 'property_instructions', count(*) from property_instructions
union all select 'expenses', count(*) from expenses
union all select 'payouts', count(*) from payouts
union all select 'organizations', count(*) from organizations
union all select 'organization_members', count(*) from organization_members
union all select 'profiles', count(*) from profiles
order by 1;

-- And confirm nothing outside these tables points at them (expect no rows):
select c.conname, c.conrelid::regclass as from_table, c.confrelid::regclass as to_table
from pg_constraint c
where c.contype='f'
  and c.confrelid::regclass::text in ('cleanings','cleaning_assignments','cleaning_events','cleaning_media',
    'properties','property_access','property_instructions','expenses','payouts','organizations','organization_members','profiles')
  and c.conrelid::regclass::text like 'st\_%';

-- 1. The trigger that keeps `profiles` alive. After this, a new sign-up writes
--    nothing but auth.users, which is all st-api needs.
drop trigger if exists on_auth_user_created on auth.users;
drop function if exists private.handle_new_user();

-- 2. A sign-up still has to work. Create a test user in Authentication → Users
--    (or let a client register), confirm st-api answers for them, and only then
--    continue. If anything is wrong, recreate the trigger from the definition
--    kept in docs/verification/2026-10-12-stage3.md and stop here.

-- 3. The prototype tables. Order follows the foreign keys between them.
drop table if exists cleaning_media;
drop table if exists cleaning_events;
drop table if exists cleaning_assignments;
drop table if exists cleanings;
drop table if exists property_instructions;
drop table if exists property_access;
drop table if exists properties;
drop table if exists expenses;
drop table if exists payouts;
drop table if exists organization_members;
drop table if exists organizations;
drop table if exists profiles;

-- 4. Fix 28: the superseded photo path. The prototype's cleaning_media rows are
--    gone with the table above; if the old storage bucket still exists and is
--    empty, remove it too. Check first — this deletes files:
select b.id, b.name, (select count(*) from storage.objects o where o.bucket_id=b.id) as files
from storage.buckets b order by b.id;
-- Only when a bucket of the prototype shows 0 files:
-- delete from storage.buckets where id='<the empty prototype bucket>';

-- 5. The site-session Edge Function is deleted from the dashboard
--    (Edge Functions → site-session → Delete), not from here. Nothing in this
--    repository calls it: `grep -rn site-session` over the application finds
--    only this file and the documentation.

-- 6. Afterwards, what remains in public should be st_* only:
select table_name from information_schema.tables
where table_schema='public' and table_name not like 'st\_%' order by table_name;
