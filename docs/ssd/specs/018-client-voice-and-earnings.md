# SSD-018 — Stage 2, first block: the client's voice and the cleaner's money

**Date:** 2026-10-12 · **Scope:** schema + Edge Function + browser · **API contract:** `2026-10-12-stage2` (new routes, so the frontend and the API move together)
**Approval:** the audit list of 2026-10-12, stage 2 fixes 16, 17 and 24.

## Fix 16 — a rating, and a complaint that reaches the right people

A finished cleaning could be looked at but not answered: `st_cleaners.rating` was a default of `5` that nothing ever moved, and a dissatisfied client had no way in at all.

- The client (owner or property manager, scoped to the property) rates a finished cleaning from 1 to 5 with an optional comment, and may correct it inside `feedbackWindowDays` (14). One row per cleaning: a correction updates it rather than adding a second opinion.
- Ticking **"this is a complaint"** additionally opens an `st_issues` row of type `CLIENT_COMPLAINT` with `HIGH` priority and notifies every administrator and operations manager. A complaint without a description is refused — a complaint nobody can act on is not a complaint.
- A rating of 1 or 2 without a complaint still notifies staff (`LOW_RATING`), because that is the signal that arrives before the complaint does.
- `st_cleaners.rating` becomes the **average of real ratings** (`st_refresh_cleaner_rating`), recomputed from the table on every submission, and falls back to 5 while a cleaner has none.
- The cleaner sees their rating as a number — on the earnings page and per cleaning — and never the client's words: `feedback_comment`, `feedback_complaint` and `complaint_description` are in the cleaner's hidden-field list. Operations reads the whole thing in the job modal.

## Fix 17 — the client's note and repeating cleanings

- **The note** could only be written at booking. It is now editable by the client until the cleaner arrives (after that it is Operations' to change, since the cleaner is already on site), the cleaner is notified when it changes, and the change is recorded as a `NOTE_UPDATED` event.
- **Repeating cleanings** existed server-side (`st_recurring` plus the nightly worker) but only an administrator could create them. The client now has a **Repeat** section: create a schedule for one of their approved properties (weekdays, start time, first and optional last day), correct it, pause and resume it, and remove it.
- A schedule cannot be moved to another property, must name at least one weekday, and must start inside the property's own window.
- Removing a schedule that **already produced cleanings** switches it off instead of deleting it, and the interface says which of the two happened. `st_jobs.recurring_id` is what tells you where a cleaning came from, and that history is worth more than a tidy table. An unused schedule is deleted outright.

## Fix 24 — the cleaner's earnings, answered by the database

The earnings route summed `payout + bonus` in the API and the browser rendered that; it could not see settlements, so "paid" and "waiting for review" did not exist. Worse, `assets/operations-extension.js` replaced the whole Earnings page for cleaners with the raw month settlement list, so the page in `app.js` was dead code.

`st_cleaner_earnings` now answers, in cents, from the jobs and the settlements: **today, this week (ISO week), this month, waiting for review, ready to be paid, already paid**, plus the completed counts, the rating and the reliability score. The page renders those six cards and nothing else: it contains no `reduce` over money, and the month-by-month settlement list is one tap away at `cleaner/settlements` rather than replacing the summary.

## Security and privacy

Both new tables (`st_job_feedback`, and `st_recurring` for the client) are RLS-denied to `anon` and `authenticated` and revoked besides; every new path is a `security definer` RPC granted to `service_role` only, and each one re-derives the caller's scope from `st_users` + `st_client_accounts` (+ `st_manager_properties` for a manager) rather than trusting the route. The API resolves the caller's own booking with `jobFor()` **before** calling the RPC, and no route writes either table directly — `tests/client-voice-contract.test.mjs` asserts all of that, plus the complaint projection.

## Verification

`docs/verification/2026-10-12-stage2-client-voice.md`.

## Open

Stage 2 still has fix 21 (admin menu in nine sections), 22 (inherited screens in all four locales), 23 (owner archive) and 25 (editable finance entries and photo captions). Stage 3 is unchanged.
