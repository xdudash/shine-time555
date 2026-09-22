# Shine Time on Hostinger + Supabase

Target URL: `https://shinetime.sk/app/`

This archive is the Hostinger shell for the existing Shine Time v4 interface. It does **not** need MySQL, `install.php`, Node.js, or a VPS. Hostinger serves the PHP/PWA files; Supabase is already connected for Auth, PostgreSQL, Realtime, Edge Functions, and proof-photo Storage.

## Upload exactly like this

1. In Hostinger hPanel open **Files → File Manager → public_html**.
2. Create `app` if it does not exist, then open `public_html/app/`.
3. Upload `Shine_Time_Hostinger_Supabase.zip` and extract its **contents** into that folder. The result must contain `public_html/app/index.php`, not `public_html/app/Shine_Time_Hostinger_Supabase/index.php`.
4. Keep `.htaccess` when extracting; it protects `config/`, the Supabase source, and the obsolete PHP/MySQL files.
5. Set PHP to **8.1 or newer** in hPanel. No MySQL database must be created.

## Create the first administrator

Open:

`https://shinetime.sk/app/setup.php`

Enter the administrator's name, email, and a password of at least 12 characters. This action can succeed only once; the first authenticated account becomes `ADMIN` and creates the locked initial-admin record in Supabase.

If Supabase email confirmation is enabled, confirm the received email, return to `setup.php`, and submit the same form once more. Then sign in at:

`https://shinetime.sk/app/`

## What is already connected

- `st-api` Supabase Edge Function — server-side permissions, roles, jobs, dispatch, finance, issue flow, account creation, password reset, and photo processing.
- PostgreSQL tables prefixed `st_` — v4-shaped data model with indexes for daily jobs, assignments, checklists, events, photos, and finance.
- `st-cleaning-media` private Storage bucket — proof photos never become public URLs.
- Supabase Realtime for `st_jobs` — dashboards refresh when another cleaner/admin changes a job.
- RLS — anonymous browser traffic cannot read or write operations data; Hostinger contains only a publishable key, never a service-role key.

## Important notes

- Do not upload a `service_role`, `sb_secret`, database password, or any `.env` file to Hostinger.
- The earlier PHP/MySQL database is not automatically imported because no MySQL credentials or data export were supplied. Keep its backup until a deliberate data migration is performed.
- Existing v4 screens and roles remain: ADMIN, OPERATIONS_MANAGER, CLEANER, OWNER and PROPERTY_MANAGER; operations, marketplace, routes, checklist/photos, issues/rescue, finance, analytics, settings, and four languages.
- The matching Supabase migrations and Edge Function are deployed before this archive is handed over. After upload, hard-refresh once so the `shinetime-shell-2026-09-01-r1` cache replaces the previous shell.

## Fast checks after upload

1. `https://shinetime.sk/app/` shows the Shine Time sign-in screen.
2. `https://shinetime.sk/app/setup.php` creates the first admin (once only).
3. Create one object, a cleaner, and a job as ADMIN.
4. Sign in as the cleaner, accept the job, update its status, complete the checklist, and upload proof.
5. Confirm the admin screen refreshes without a manual reload after the cleaner changes the job, and that a property manager only receives updates for explicitly assigned properties.
