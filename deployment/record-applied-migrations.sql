-- Stage 1, fix 26: tell Supabase which migrations are already applied.
--
-- Why this exists: several migrations were applied by hand in the SQL editor
-- (1 October and 12 October 2026), so the database has their objects but
-- `supabase_migrations.schema_migrations` does not have their rows. A future
-- `supabase db push` would try to run them again, and some are not idempotent.
--
-- This file only writes history rows. It changes no table, no function and no
-- policy, and it is safe to re-run (`on conflict do nothing`).
--
-- Run it in Supabase → SQL Editor AFTER the three stage 1 migrations are
-- applied (dispatch, notification delivery, settings cleanup). Check the
-- "already applied" list below against your own database first: only add a
-- version whose objects really are there.

-- 1. What the database thinks is applied, before the change:
select version, name from supabase_migrations.schema_migrations order by version;

-- 2. The versions that were applied by hand and are missing from history.
--    The three names matched by a different version stamp (the v4 Hostinger
--    schema, the roles/portfolio pair and security_phase1) are deliberately NOT
--    re-recorded: they are in history under the stamp the CLI gave them.
insert into supabase_migrations.schema_migrations(version, name)
values
  ('20260914000100','lock_raw_jobs_client_access'),
  ('20260914090000','phase2_integrity'),
  ('20260928155407','quality_review'),
  ('20260930120000','production_reconcile'),
  ('20261001090000','request_id_guard_search_path'),
  ('20261012090000','stage1_dispatch'),
  -- Add these two only after they are applied (they are part of the
  -- notification slice; the lines are harmless beforehand only if you have
  -- already run them):
  ('20261012120000','notification_delivery'),
  ('20261012140000','settings_cleanup')
on conflict (version) do nothing;

-- 3. The result. Every repository migration should now appear here, except the
--    older ones that are recorded under a CLI-assigned version with the same name.
select version, name from supabase_migrations.schema_migrations order by version;
