# SSD-017 — Stage 1 close-out: measured analytics, audited settings, full job form

**Date:** 2026-10-12 · **Scope:** Edge Function + browser (no new table; one `delete` migration) · **API contract:** `2026-10-12-stage1`
**Approval:** the audit list of 2026-10-12, fixes 12, 13, 18 and 26.

## Fix 12 — analytics measured from the job history

The page used to show five numbers, of which `onTimePct` was computed as "completed before 15:00 UTC" (a global cutoff that the window booking had already made meaningless), `byDate` was returned empty, and `objectPerformance` averaged the *configured* duration — comparing the standard against itself. Nothing was read from `st_job_events`.

Now `supabase/functions/st-api/analytics.mjs` computes everything from the jobs in the period plus their event trail, as pure functions:

| Number | How it is measured |
| --- | --- |
| On time | `completed_at` against **each job's own deadline**, read in Bratislava time including across the DST change (`zoneOffsetMinutes`). Jobs with no timestamp are excluded from the denominator rather than counted as on time. |
| Median time to take | first `JOB_CREATED`/`CLIENT_BOOKED` to first `CLEANER_ACCEPTED`/`ADMIN_ASSIGNED`. A job never taken does not count as instant. |
| Expired without a cleaner | `EXPIRED` status, plus its share of all cleanings |
| Rescue, escalated | `RESCUE_OPENED` events, `RESCUE` status or `rescue_state`, and `escalated_at` |
| Rework | `REVIEW_REJECTED` events as a share of **completed** jobs |
| Check-ins outside the property, late releases | `CHECKIN_OUTSIDE_RADIUS` and `CLEANER_CANCELLED_LATE` events |
| Cancellations | split into client / operations / other by `CLIENT_CANCELLED` and `ADMIN_CANCELLED` |
| Overrun when late | median minutes past the deadline, over the jobs that were late |
| Per day | one row per service date: cleanings, completed, expired, rescue, its own on-time rate |
| Funnel | booked → taken → arrived → completed → approved, counted where each cleaning stopped, so the steps always add up |
| Property standards | average **worked** time (`actual_start` → `completed_at`) next to the configured standard and the difference, so a wrong standard is visible |

Every rate carries the denominator it came from (`onTimeOf`, `acceptedOf`, `reworkOf`) and an empty period returns `null`, never a comforting 100%. The page gained a period selector (7/30/90 days, this month, all time), two inline trend charts drawn as SVG without a chart library, the funnel and the property table; it says "not enough days in this period" instead of drawing an empty frame.

## Fix 13 — every setting is either wired up or gone

Nine settings were editable while nothing read them, so changing them did nothing:

| Removed | Why |
| --- | --- |
| `windowEnd`, `rescueStart` | superseded by the per-property deadline and by `rescueHours` |
| `sameZoneTravelBuffer` | never applied; `travelBuffer` is the only buffer used |
| `surge2Start`, `surge4Start`, `surge6Start` | an abandoned surge-pricing idea |
| `clientCancellationCutoffHours` | client cancellation is free until the cleaner arrives (decision 8) |
| `clientBookingStepMinutes` | fixed-slot booking was replaced by window booking |
| `defaultLanguage` | every account carries its own language |

They are gone from `settings()`, from the form, and their stored rows are deleted by `20261012140000_settings_cleanup.sql`. The dead `availableBookingSlots` helper that `clientBookingStepMinutes` drove is removed with them, and `client/slots` now returns the window, the price and the capacity it is actually asked for.

Four stage 1 dispatch settings and three notification settings were the reverse problem — read by the server, editable nowhere. They are now in the form, grouped under Planning / Dispatch / Notifications. `companyName` was stored and never shown; it now names the operator in the sidebar and in the document title.

`tests/settings-contract.test.mjs` keeps all three in step: every server setting has a reader, every server setting is in the form, every form field exists on the server, and the retired keys stay retired.

## Fix 18 — admin job creation sends what the server accepts

The form asked for a property, a date, a planned start, a bonus and marketplace visibility; `st_create_job` has accepted `earliestStart`, `deadline`, `durationMinutes`, `payout`, `clientPrice` and `note` since stage 1, so the rest of a cleaning could only be fixed after creating it. The form now carries all of it, prefilled from the chosen property (window, duration, payout, price), with the server's own rule checked while typing — start + duration must fit the window — and the submit button disabled while it does not, showing the latest possible start when it does. Payout and price are administrator-only, matching the server guard.

## Fix 26 — the migration history

`deployment/record-applied-migrations.sql` records the six migrations that were applied by hand (and the two of this slice, once applied) in `supabase_migrations.schema_migrations`, so a future `supabase db push` does not try to re-run them. It writes history rows only, is `on conflict do nothing`, and deliberately does not re-record the three older migrations that are already in history under a CLI-assigned version with the same name.

## Verification

`docs/verification/2026-10-12-stage1-closeout.md`.

## Open

Fix 20 (Supabase dashboard: Redirect URLs and leaked-password protection) is the owner's own action in the dashboard; it cannot be done from the repository. Stage 2 and stage 3 are unchanged in `docs/MASTER_PLAN.md`.
