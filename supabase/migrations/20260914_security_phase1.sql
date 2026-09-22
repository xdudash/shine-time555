-- Phase 1 security hardening.
-- The API uses the Supabase service role for media access, so the application
-- bucket must not be publicly readable. Signed URLs remain the only client
-- delivery mechanism.
update storage.buckets
set public = false
where id = 'st-cleaning-media';

-- Defense in depth: authenticated/anonymous clients must not mutate backend
-- domain tables directly. All sensitive writes go through st-api/RPCs.
revoke insert, update, delete, truncate on public.st_users from anon, authenticated;
revoke insert, update, delete, truncate on public.st_cleaners from anon, authenticated;
revoke insert, update, delete, truncate on public.st_client_accounts from anon, authenticated;
revoke insert, update, delete, truncate on public.st_objects from anon, authenticated;
revoke insert, update, delete, truncate on public.st_jobs from anon, authenticated;
revoke insert, update, delete, truncate on public.st_job_checklist from anon, authenticated;
revoke insert, update, delete, truncate on public.st_job_photos from anon, authenticated;
revoke insert, update, delete, truncate on public.st_job_events from anon, authenticated;
revoke insert, update, delete, truncate on public.st_issues from anon, authenticated;
revoke insert, update, delete, truncate on public.st_notifications from anon, authenticated;
revoke insert, update, delete, truncate on public.st_financial_entries from anon, authenticated;
revoke insert, update, delete, truncate on public.st_cleaner_availability from anon, authenticated;
revoke insert, update, delete, truncate on public.st_settings from anon, authenticated;
revoke insert, update, delete, truncate on public.st_recurring from anon, authenticated;
revoke insert, update, delete, truncate on public.st_recurring_runs from anon, authenticated;
revoke insert, update, delete, truncate on public.st_upload_tickets from anon, authenticated;

-- Keep read access explicitly limited to the tables already exposed through
-- the API/realtime surface. RLS remains the authorization boundary.
grant select on public.st_users, public.st_cleaners, public.st_client_accounts, public.st_jobs to authenticated;
