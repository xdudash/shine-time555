# Verification — stage 1 close-out (analytics, settings audit, job form, migration history)

**Date:** 2026-10-12 · **Branch:** `feat/stage1-notifications` · **Spec:** `docs/ssd/specs/017-analytics-settings-job-form.md`
**Not deployed.** Shares the branch and the pull request with the notification slice.

## Environment limits

Same as the notification slice: no npm registry here, so `npm ci`/`npm run build` run in CI, and **`sw.js` still needs regenerating on a machine with the toolchain** (that is the notification service worker, unchanged by this slice). The database suites ran against local PostgreSQL 16 through a driver shim in `node_modules`; CI runs them on PGlite.

## 1. Node suites

`node --test tests/*.test.mjs` → **186 tests, 186 pass, 0 fail** (173 before this slice: +12 analytics, +5 settings contract, −4 removed with the dead helper).

**Analytics** (`tests/analytics.test.mjs`, 12 tests) — the ones that would have caught the old page:

- On time is measured against each job's own deadline: three jobs, one in time, one 40 minutes over, and one with a 20:00 deadline finishing at 17:00Z that the old global 15:00 rule called late → `onTimePct 66.7`, `onTimeOf 3`, median overrun 40.
- The deadline is read in Bratislava time: 21:45Z against a 23:30 deadline is 15 minutes late, 21:00Z is in time, and a January job with `offsetMinutes: 60` is judged on winter time. `zoneOffsetMinutes` returns 120 in summer, 60 in winter, 60 on 25 October (the day the clocks go back), 120 on the 24th, and 0 for a broken date instead of throwing.
- A completed job with no `completed_at` is left out of the denominator, not counted as on time.
- An empty period returns `null` rates — explicitly asserted not to be 100%.
- Time to take uses the median of the event trail; a job never taken is not an instant acceptance.
- Expiry, rescue, escalation, rework, radius and late releases all come from events/columns, with rework as a share of completed jobs.
- Cancellations split client/operations/other, and the remainder is not attributed to anyone.
- The funnel counts where each cleaning stopped, never exceeds the jobs in the period, and is asserted step by step.
- The daily series is sorted, one row per service date, each with its own rate.
- Object performance averages **worked** minutes (`actual_start` → `completed_at`), reports `+15 min` against a 90-minute standard, and returns `null` for a property where nothing was worked instead of inventing an average.

**Settings contract** (`tests/settings-contract.test.mjs`, 5 tests) — every server setting has a reader (in the API, the logic modules, a migration, or the browser for a displayed label); every server setting is editable in the form and every form field exists on the server; the nine retired keys are gone from all three places and deleted by the cleanup migration; the four dispatch and three notification settings are present in the form; and the dead slot helper is gone, with `client/slots` no longer returning a slot list.

Removed with the dead code: the four `domain.test.mjs` tests that covered `availableBookingSlots`. They tested a helper nothing called after the window booking; the window rules they used to protect are covered by the four marketplace tests added in stage 1 and by `tests/sql/stage1-scenarios.sql` §6.

## 2. SQL

Full chain from scratch including `20261012140000_settings_cleanup.sql`: `chain-ok`. The cleanup is a `delete` of nine rows by key; no schema object is touched.

`deployment/record-applied-migrations.sql` was written against the live history read from the project: `supabase_migrations.schema_migrations` holds 23 rows, and the six repository migrations missing from it (`lock_raw_jobs_client_access`, `phase2_integrity`, `quality_review`, `production_reconcile`, `request_id_guard_search_path`, `stage1_dispatch`) are exactly the ones applied by hand on 1 and 12 October. The three older migrations whose names appear under a different version stamp are deliberately left alone.

## 3. Browser suites

`tests/usability-browser.mjs` → 14 blocks, two new:

**PASS analytics: measured KPIs with denominators, inline trends, funnel, period selector and an honest empty period** — the KPI row shows the API's 75% with "of 8" beside it, the 95-minute median, the expiry share next to the count and the 12.5% rework; both trends render as inline SVG with a dot per day; the funnel has five rows whose bar widths are asserted to shrink monotonically; a property with a standard 22 minutes under reality is flagged and one with no cleanings is left out; clicking "Last 7 days" changes the query to a seven-day inclusive range with the same end date; and with an empty period the page shows "—", "nothing measurable yet" and "Not enough days in this period", with no 100% anywhere.

**PASS admin creates a cleaning with window, duration, money, visibility and a note** — the form opens prefilled from the property (10:00 / 15:00 / 90 min) and says the latest start is 13:30; a 400-minute duration is refused with "window is too short" and the submit button is disabled; a ready-by before the start is refused; and a valid cleaning posts exactly `{objectId, serviceDate, earliestStart, deadline, durationMinutes, bonus, marketplaceVisible, note, payout, clientPrice}`.

All other browser suites pass unchanged, including the production bundle (`st-api v14 (2026-10-12-stage1)`). The preview analytics fixture was updated to the new response shape; `scripts/check-preview.mjs` passes.

## 4. Translations

The ru/uk/sk crawl over every screen of every role reports only the three intentional English strings (`Email`, `IČ DPH`, `🧭 Google Maps`). About 70 new labels per language were added for the analytics page, the regrouped settings form and the job form. The crawl also caught a real defect introduced in this slice: the preview's analytics fixture still had the old shape, so the page threw `Cannot read properties of undefined (reading 'map')` — fixed before this was written.

## 5. Not verified here

- Fix 20 (Supabase dashboard Redirect URLs and leaked-password protection) is a dashboard action, not code.
- The analytics numbers are verified against synthetic histories; the first look at real production numbers is the owner's acceptance step after deployment.
