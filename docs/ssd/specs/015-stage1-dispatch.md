# SSD-015 — Stage 1: window bookings, marketplace dispatch, team accounts

**Date:** 2026-10-12 · **Scope:** schema + Edge Function + browser · **API contract:** `2026-10-12-stage1`
**Approval:** owner decision list of 2026-10-12 ("Все делаем из списка" + 9 product answers). Covers audit fixes 1–4, 6–11, 14 and 19; fix 26 (recording the four hand-applied migrations in Supabase's migration history) is part of the deployment steps, not of the code.

## Product decisions this slice implements

| # | Decision (owner, 2026-10-12) |
| --- | --- |
| 1 | Dispatch is a marketplace first. No auto-assignment on booking. Manager is warned 24 h before an unassigned cleaning; rescue (bonus, push to every cleaner) opens 3 h before. |
| 2 | A client books a **window** (not before / ready by), not a fixed slot. The cleaner chooses the start inside that window when taking the job. |
| 3 | The client sees the cleaner's **name**, never the phone number. |
| 4 | A property manager sees reports for his own properties, **without cleaner payout and without margin**. |
| 6 | No card payments. |
| 7 | Notifications: push + email only. |
| 8 | Cancellation is free for now (no fee), but a late cleaner release costs reliability score. |
| 9 | No split by city. |

## Behaviour

| Role | Change |
| --- | --- |
| Client / owner | Booking form asks for the property, the day and a window (`Not before`, `Ready by`) plus an optional note for the cleaner. `Ready by` must be later than `Not before` and leave room for the standard duration. The job is created `UNASSIGNED` and published to the marketplace; no cleaner is pre-assigned. The note is visible to the client, the cleaner who takes the job, and operations. Cancel is hidden once the cleaner has arrived or is cleaning, and for expired jobs. |
| Cleaner | "Available cleanings" lists 7 days as chips. Each offer shows the client window, the earliest start that actually fits (`earliest_feasible_start`), the latest possible start, the projected finish, the client note, the bonus, and — when the job cannot be taken — the honest reason (not enough time before the deadline, conflicts with your other jobs that day, you marked this day as off, daily limit reached). The cleaner picks `I start at` from 15-minute options and the server validates the same window. A release is allowed in `ACCEPTED` and `EN_ROUTE`; later than `cleanerCancellationCutoffMinutes` (180) before the deadline it opens rescue with a bonus and costs 5 reliability points. |
| Cleaner | Check-in records the distance to the property. Beyond `checkinRadiusMeters` the job continues but a `CHECKIN_OUTSIDE_RADIUS` event is written and operations is notified. |
| Admin | **Team** section: cleaners and a new **Operations managers** list — add, edit, deactivate, reset password. Only an administrator may create or change managers. |
| Operations manager | Reaches the cleaner list and the job board; cannot create managers, cannot delete a property, and cannot change `clientPrice`, `payout` or `clientId`. Finance totals (`month_revenue`, charged/received/due) stay hidden. |
| Property manager | Gets the finance tab: monthly settlement report for his linked properties with client-side amounts only — `earnedCents`/payout and margin are not sent. |
| All | Passwords are validated by the shared `isStrongPassword` rule (12 characters) on every creation and reset path. A property address or coordinate change only forces re-approval when it actually moved (> ~0.0005°). 52 new RU/UK/SK labels; the Russian, Ukrainian and Slovak crawl is clean apart from `Email`, `IČ DPH` and `🧭 Google Maps`, which stay as they are by design. |

## Schema (`supabase/migrations/20261012090000_stage1_dispatch.sql`)

- `st_jobs.status` gains `EXPIRED`.
- `st_jobs_object_id_service_date_key` is replaced by a partial unique index `st_jobs_one_active_per_object_day … where status not in ('CANCELLED','EXPIRED')`, so a cancelled or expired cleaning no longer blocks rebooking the same property for the same day.
- New columns: `client_note` (≤ 1000 chars), `checkin_distance_m`, `escalated_at`, `expired_at`.
- New settings: `cleanerCancellationCutoffMinutes=180`, `rescueBonus=6`, `managerEscalationHours=24`, `rescueHours=3`.
- `st_notify_staff(type,title,message)` notifies every active `ADMIN` and `OPERATIONS_MANAGER`.
- `st_create_job` never auto-assigns; it accepts `earliestStart`, `deadline`, `note`, publishes to the marketplace and notifies cleaners and staff.
- `st_job_command` accept branch picks the first free 15-minute start inside the window when the client gave none — the same scan the browser and `logic.mjs` run, so the UI and the server can no longer disagree. Cancel rules per the decisions above.
- `st_dispatch_tick()` expires jobs past their deadline, opens rescue `rescueHours` out and escalates to staff `managerEscalationHours` out; returns `{expired,escalated,rescue}`. Scheduled every 15 minutes by `deployment/stage1-schedule.sql` (kept out of the migration on purpose: cron is a shared resource and is registered by hand once).
- `st_settlement_report` answers for `PROPERTY_MANAGER` over linked objects, client-side amounts only.
- `st_validate_job_command_request_id()` gets an explicit `search_path`.

## Security and privacy

Every new rule is enforced in SQL or in the Edge Function, never in the browser: the cleaner's chosen start is re-validated against the window and the cleaner's own schedule inside `st_job_command`; the operations-manager restrictions are a route+field guard in `index.ts` plus the hidden-field lists in `security.mjs`; `cleaner_phone` is in the client's hidden-field list, so the name is sent and the number is not; the property-manager report is produced by the `security definer` RPC with its own scope check and never contains payout or margin. Marketplace projections expose only `MARKETPLACE_FIELDS` (now also `earliest_feasible_start`, `latest_start`, `client_note`).

## Verification

See `docs/verification/2026-10-12-stage1.md`.

## Open

Push and email delivery (fix 5) is decided but not built — notifications are still in-app rows. Analytics (12), dead settings (13), the richer admin job form (18) and the Supabase dashboard hardening (20) remain for the next slices, as do all stage 2 items.
