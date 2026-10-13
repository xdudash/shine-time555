# Verification — stage 2, first block (rating and complaint, note, repeating cleanings, earnings)

**Date:** 2026-10-12, evening · **Branch:** `feat/stage2-client-voice` · **Spec:** `docs/ssd/specs/018-client-voice-and-earnings.md`
**Not deployed.** This slice adds API routes, so the build string moves to `2026-10-12-stage2` and the frontend and the API must be deployed together.

## Environment limits

As before: no npm registry here, so `npm ci` / `npm run build` run in CI and **`sw.js` must be regenerated** on a machine with the toolchain (its build string is bumped in this commit, but the file is the previous bundle). Database suites ran against local PostgreSQL 16 through a driver shim in `node_modules`; CI runs them on PGlite.

## 1. SQL — the new rules on real PostgreSQL

Full chain from scratch including `20261012170000_client_feedback_recurring.sql`: `chain-ok`.
Scenarios: `tests/sql/stage2-scenarios.sql`, exit code 0, 14 sections.

| # | Scenario | Observed |
| --- | --- | --- |
| 1 | Who may rate | a cleaner and an administrator are both refused (`Only the client side can rate a cleaning`); an unfinished cleaning is refused (`Only a finished cleaning can be rated`) |
| 2 | The owner rates 4/5 | feedback row written, `st_cleaners.rating` becomes `4.00` — the first time that column has ever moved |
| 3 | A correction | the same row is updated to 5, still **one** feedback row, rating back to `5.00` |
| 4 | Bad input | `rating: 9` refused, a complaint with no words refused |
| 5 | A complaint | `CLIENT_COMPLAINT` issue at `HIGH`/`OPEN` with the description, `COMPLAINT` notifications to the administrator **and** the operations manager, and both `CLIENT_RATED` and `CLIENT_COMPLAINT` events on the job |
| 6 | After the window | with `feedbackWindowDays = 1` and a cleaning finished 3 days ago: `The rating window for this cleaning has closed (1 days)` |
| 7 | Another owner | `Forbidden` |
| 8 | The note | the client sets it and the assigned cleaner is notified; still changeable at `EN_ROUTE`; refused once `ARRIVED` (`The cleaner is already at the property; contact Operations`); Operations can still change it afterwards |
| 9 | Recurring | empty for a fresh owner; a created schedule is listed with its weekdays and start; an unlinked property manager sees **0** |
| 10 | Correcting a schedule | paused and re-timed in place; moving it to another property refused; no weekday refused; a start outside the property window refused |
| 11 | Removing a schedule | one that produced a cleaning returns `{"deleted":0,"deactivated":1,"generatedJobs":1}` and the cleaning keeps its `recurring_id`; an unused one returns `{"deleted":1,…}`; a stranger's id is `Schedule not found` |
| 12 | Earnings | with one approved job (20 €, 15 € paid) and one pending (25 € + 6 € bonus): `week/month/today 5100`, `payable 500`, `waitingReview 3100`, `paid 1500`, `completedWeek 2` — and a client calling it is `Forbidden` |
| 13 | Exposure | `has_table_privilege('authenticated','st_job_feedback','select')` false; `has_function_privilege` false for both the feedback and the earnings RPC |

Two design bugs were found by writing these scenarios rather than after deployment:

1. **A schedule with generated cleanings could not be deleted at all** — `st_jobs.recurring_id` is a restricting foreign key, so the first version raised a constraint violation instead of the friendly behaviour the comment promised. It now deactivates and reports which happened.
2. An ambiguous `r.object_id` between the PL/pgSQL row variable and the table column, which only shows up when the function actually runs.

## 2. Node suites

`node --test tests/*.test.mjs` → **197 tests, 197 pass** (191 before; +6).

`tests/client-voice-contract.test.mjs`:
- A complaint projected for every role: the cleaner gets `feedback_rating` but **not** `feedback_comment`, `feedback_complaint` or `complaint_description` (and still no `client_price`); both staff roles read the complaint; the client who wrote it reads it back and still sees no `payout`.
- All six new RPCs are called through `service.rpc`, granted to `service_role` only and revoked from `public, anon, authenticated`; no route writes `st_job_feedback` or `st_recurring` directly; the feedback table carries a `using (false) with check (false)` policy.
- `client/bookings/{id}/feedback` and `…/note` both call `jobFor(ctx, jobId)` **before** the RPC (asserted by index order, not by eye), and the admin note edit sits behind the admin router.
- The rating window, the "finished only" rule and the rating average are the database's decision; the browser only renders `d.rating.canRate` and never sets it.
- The earnings page reads `e.week`, `e.month`, `e.waitingReview`, `e.payable`, `e.paid` from the server, converts cents once, and contains **no** `reduce` over money.
- The deactivate-instead-of-delete behaviour is asserted in both the migration and the message the browser shows.

## 3. Browser suites

`tests/usability-browser.mjs` → **17 blocks**, three new, all at 390 px:

- **PASS client rates a cleaning, files a complaint with words, and edits the note** — sending with no stars is refused in the interface, a complaint with no words is refused, both refusals leave the request unsent (asserted on the captured payload, not just the toast), the accepted submission posts exactly `{rating: 2, comment: 'Bathroom was not cleaned', complaint: true}`, the card comes back editable with that content, and the note editor saves through `PATCH …/note`.
- **PASS client creates, corrects, pauses and removes a repeating cleaning** — unchecking every weekday is refused, `[1,3,5]` at 11:00 is posted and rendered as `Mon · Wed · Fri · 11:00` with "2 cleanings created", pausing posts `active: false`, and removing one that already created cleanings reports *"Schedule paused because it already created cleanings"* rather than claiming a delete.
- **PASS cleaner earnings: week, month, waiting for review, payable, paid and rating** — all five amounts come from the server's cents, the rating and reliability are shown, the client's rating of a cleaning appears on its card, and there is no horizontal scroll.

Writing these caught three real defects: `window.recurringModal`, `saveRecurring`, `toggleRecurring` and `removeRecurring` **already existed** in `assets/operations-extension.js` for the admin recurring screen, so the client handlers silently called the admin ones (renamed to `clientRecurring*`); the same extension replaced the cleaner Earnings page entirely, so the new cards would never have been seen (it now owns `cleaner/settlements` instead, reachable from a button on the earnings page); and exporting `window.settlementScreen` as an arrow of the same name as the existing global function made it call itself until the stack blew — caught by the translation crawler, which renders every screen of every role.

All other browser suites pass unchanged, plus the production bundle at the new build string.

## 4. Translations

The ru/uk/sk crawl over every screen reports only the three intentional English strings (`Email`, `IČ DPH`, `🧭 Google Maps`). About 60 new labels per language.

## 5. Not verified here

- Nothing of this slice is deployed. Order: merge, apply `20261012170000_client_feedback_recurring.sql`, deploy `st-api`, publish the frontend (the build string moves to `2026-10-12-stage2`, so the two must land together).
- Real client behaviour (do owners actually rate?) is only answerable after it is live; the new `CLIENT_RATED` / `CLIENT_COMPLAINT` events feed the analytics page, so the answer will be visible there.
