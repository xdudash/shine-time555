# Development verification — 2026-09-07-scale1

Production backend deployed on 2026-09-08. Hostinger frontend upload by the owner
is pending; this is not full production UI acceptance.

Deployment: all six scale1 migrations applied; st-api version 6 ACTIVE with JWT
verification; deployed source matches all five local modules exactly. Recurring
Cron is active at 02:15 UTC daily. No recurring templates currently exist.
The application-data backup was saved privately, then restored in isolated
PostgreSQL: all 17 tables matched, and migrations preserved row counts. This
backup excludes Auth credentials and Storage object bytes, which were not changed.
Production counts remain 3 users, 4 objects, 7 jobs, 8 photos, 112 checklist rows
and 24 events. Finance/settlement SQL reports execute; unauthenticated API returns
HTTP 401. Signed-in production UI journeys await the frontend upload.

Implemented: transactional job commands; scoped realtime signals; role response
projection; stable live UI and password recovery; individual service windows;
recurring schedule generation and isolated-error worker; exact settlement ledger;
paginated settlement and manual payment history; SQL finance/trend aggregation;
direct signed photo/video upload and idempotent finalization; transactional proof
and checklist writes; retention-aware cleanup of unreferenced expired uploads.
The previous photo API and client build identifier remain accepted during rollout.
Realtime requires the new frontend subscription to st_job_signals.

Verified:
- Isolated Supabase integration passed (GitHub run 34170564053): real Auth for
  all five roles, owner booking, cleaner transitions/checklist, signed Storage
  upload/download, repeated finalization/completion, settlement recording, real
  Realtime delivery and private job access. No production data used.
- GitHub repository: https://github.com/xdudash/shine-time (private).
- Native PostgreSQL 17 contention test passed: 50 concurrent claims, one winner;
  50 repeated completions, one event; 50 independent jobs accepted concurrently.
  CI run 34170564075 completed successfully.
  This tests database correctness, not live Auth/Storage or an end-to-end SLA.
- 41 automated tests pass, none skipped. SQL tests use isolated PGlite PostgreSQL.
- Full database workflow: owner booking, automatic assignment, status transitions,
  checklist, required photo, completion, client payment and cleaner payout.
- Browser fixtures: unsaved input/focus survive realtime; mobile width; cleaner
  navigation; quoted photo categories; video preview; photo upload UI; recurring
  and settlement screens. These tests use synthetic API responses, not live Auth.
- 100,000 synthetic jobs: exact totals, settlement report 1,640 ms with a bounded
  100-row page; finance report 1,159 ms. These are local measurements, not an SLA.
- Frontend build, Edge Function bundle and PHP syntax checks pass.

Mandatory release gates still open:
- Full role-specific production UI acceptance after frontend upload.
- Full localization acceptance, exports and remaining operational history review.
- Operational monitoring and alerts.
- Hostinger frontend update: unpack Shine_Time_app_update.zip directly into
  public_html/app, replace included files and preserve existing .htaccess.

Bank/card transfers are not integrated: settlement entries record actual external
payments and corrections; they do not move money.

Reproduce local checks: npm ci; npm test; npm run build; node tests/browser.mjs.
See deployment/README.md and scripts/test-concurrency.mjs for additional gates.
