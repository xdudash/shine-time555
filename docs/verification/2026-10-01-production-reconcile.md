# Release 2026-10-01 — production reconciliation and quality review

**Scope:** bring the repository and the production Supabase project `qbbtroiqioufuucrqair` to one source of truth, then enable the quality-review workflow in production.
**Authorization:** owner approved on 2026-10-01 (read production schema; after green CI apply migrations and deploy the API).

## Findings before the release (read-only, 2026-10-01)

- Production `st-api` v11 (`2026-09-07-scale1`) contained features missing from the repository: monthly settlements and batch settlement, property reference photos, hiding entry details from cleaners outside active work, property-manager portfolio management, object service category, admin job cancel, user activation toggle, empty-update guards.
- Production migrations `20260909150213_monthly_settlements` and `20260909220128_property_reference_photos` were missing from the repository. They are now recovered verbatim.
- Repository migrations not yet in production: `security_phase1`, `lock_raw_jobs_client_access`, `phase2_integrity`, `quality_review`.
- **Defect fixed before deployment:** `20260914_security_phase1.sql` granted `SELECT` on raw `st_jobs` to `authenticated`. Production had no such grant. Combined with the existing `st_jobs_realtime_read` policy it would have exposed client prices and notes of open marketplace jobs to every cleaner. The grant was removed and the file renamed to `20260913235900_security_phase1.sql` so every tool orders it deterministically. A unit test now forbids browser grants on `st_jobs`.
- Production `st_job_command` is byte-for-byte the pre-quality repository version, so `quality_review` applies cleanly on top.
- Preconditions: settlement amounts 2000–4000 cents (inside the new check), all buckets private, no invalid command request IDs, no review columns yet.

## Changes

| Area | Change |
| --- | --- |
| API | Production-only routes ported into repository `st-api`; `property-photos.mjs` added; quality review kept. Build `2026-09-28-quality1`. |
| Projection | Cleaners receive access, key, parking, linen, supplies, Wi-Fi and object notes only for `ACCEPTED/EN_ROUTE/ARRIVED/CLEANING` jobs. |
| SQL | `20260930120000_production_reconcile`: monthly settlement lists only approved work and reports `waitingReviewJobs`; trigger functions are no longer callable through the Data API; immutability trigger has a pinned `search_path`; browser grants removed from backend-only `st_manager_properties` and `st_user_permissions`. |
| Frontend | Pinned to API `2026-09-28-quality1`, st-api v12, quality review enabled. Frontend build `2026-10-01-quality1`. |
| Hosting | `.htaccess` additionally blocks `deployment/`, `docs/`, `scripts/`. |
| Tests | Integration test on real Auth/Storage: entry details and reference photos withdrawn after completion, photo access per role, portfolio linking, monthly settlement blocked before approval and idempotent batch after approval, operations manager denied finance. Unit tests: guide projection and migration ordering and grant safety. |

## Production baseline (counts only, before deployment)

users 3 · cleaners 1 · clients 1 · objects 4 · jobs 18 (4 completed) · checklist 208 · job photos 19 · events 69 · settlements 4 (10000 cents) · object photos 2 · settlement batches 2 · recurring 1 · finance entries 0.

## Deployment order

1. CI green on the PR (unit, PGlite, native PostgreSQL concurrency, isolated Supabase integration, browser).
2. Apply to production in order: `20260913235900_security_phase1`, `20260914000100_lock_raw_jobs_client_access`, `20260914090000_phase2_integrity`, `20260928155407_quality_review`, `20260930120000_production_reconcile`.
3. Deploy `st-api` from `supabase/functions/st-api` with JWT verification (becomes v12).
4. Merge the PR; the Pages workflow publishes the frontend pinned to v12.
5. Verify: counts unchanged, historical completed jobs `APPROVED`, settlement totals unchanged, API health reports `2026-09-28-quality1`, unauthenticated API returns 401, security advisors, live `release.json`.

Between steps 3 and 4 the published frontend shows "Update in progress" for a few minutes; no data is at risk.

## Rollback

- **Data:** the migrations only add columns, replace functions, add constraints and revoke grants. No customer row is deleted or rewritten; `review_status` is set on new columns only. There is nothing to restore.
- **API:** redeploy `deployment/rollback/st-api-v11/` (entrypoint `index.ts`, JWT verification on) and revert `deployment/pages-production.json` to `2026-09-07-scale1` / `qualityReview:false` / edgeVersion 11 with the matching `scripts/build-production.mjs` guard.
- **SQL behavior:** prefer forward fixes. If v11 must run for longer, restore the pre-quality `st_job_command`, `st_record_settlement` and `st_settlement_report` definitions from `20260906233539_operations_commands.sql`, `20260906235043_operations_finance.sql` and `20260907045411_finance_aggregates.sql`; the added columns can stay.

## Still open after this release

- Password-recovery redirect URL for `https://xdudash.github.io/shine-time555/` in Supabase Auth settings and leaked-password protection (dashboard settings, owner action).
- Move from GitHub Pages to `shinetime.sk/app` (owner plans to do this later).
- Product scope still listed in `docs/MASTER_PLAN.md` (organizations/cities, teams, packages, reclamation lifecycle, server notifications).
