# Release procedure — 2026-09-07-scale1

This source has local verification; it is not a production acceptance certificate.
Keep the existing Hostinger app and database identity. Do not run setup.php or
replace the database with the baseline schema.

1. Back up the Hostinger app directory and use the Supabase backup/export facility.
   Verify restore on an isolated environment before production migration.
2. Run the CI workflow in an empty disposable PostgreSQL database. The concurrency
   script refuses a populated database or a name not starting with shine_test_.
3. Apply only the new migration files dated 20260906 and 20260907, in filename order,
   to staging first. Run all five-role journeys with real Auth and private Storage.
4. Deploy st-api with index.ts and all sibling .mjs modules, JWT verification on.
   The backend accepts the previous 2026-09-01-r1 client during the rollout.
5. Upload the built frontend atomically to Hostinger /app: index.php, sw.js,
   manifest.webmanifest, assets/, and config/supabase.php. Preserve existing server
   rewrite/protection configuration. This config has public keys only.
6. Verify sign-in, recovery redirect to /app, booking, assignment, photo/video,
   completion, finance, notifications, permissions and mobile navigation. Confirm
   health returns apiVersion 2026-09-07-scale1. Test with staging records first.
7. Enable deployment/enable-recurring.sql only after acceptance. Review
   st_recurring_runs for per-template errors and cron.job_run_details for scheduler
   failures. The worker creates a rolling 30-day horizon, uses local service dates,
   and does not duplicate existing property/day bookings.

Rollback: disable the named Cron job; restore the frontend backup and previous Edge
Function. Keep new tables and financial records. Do not drop migrations containing
new payments, uploaded evidence or generated jobs. Database restore can lose records
created after the backup and requires an explicit recovery plan.

Expired upload tickets: ADMIN POST admin/media/cleanup removes only unreferenced
objects whose upload permission expired over 48 hours ago, 100 per call. It never
removes evidence referenced by a job. Legacy untracked objects are not swept.

Money records are an accounting ledger. They do not initiate bank/card transfers.
Native PostgreSQL contention and 50 independent concurrent jobs passed in GitHub
Actions run 34155083282. Real Auth/Storage acceptance and release gates remain.
Database-only results do not certify production capacity.

The verify workflow produces the hostinger-frontend artifact with a minimal ZIP
and SHA-256 file manifest. It excludes legacy setup scripts, SQL, Node dependencies
and backend sources. Extract into the existing /app only after the release gates;
preserve the existing .htaccess and back up the current directory first.
