# Verification — stage 1 live in production

**Date:** 2026-10-12, evening · **Checked against:** project `qbbtroiqioufuucrqair` after the owner merged PR #16, rebuilt `sw.js` (`79c7f28`), applied the migrations, set the function secrets and ran both schedule files.

## What is deployed

| | State |
| --- | --- |
| `st-api` | v28, `verify_jwt = false` (see below) |
| Frontend | Pages build `2026-10-12-stage1`, matching the API build string |
| Migration history | 31 rows; all nine repository migrations from `20260914` onward are recorded, including `stage1_dispatch`, `notification_delivery` and `settings_cleanup` (fix 26 done) |
| Schema | both notification tables, the two preference columns, all six notification functions, the `st_notifications_enqueue` trigger, the three notification settings |
| Dead settings | 0 rows left of the nine removed by `settings_cleanup` |
| `pg_net` | installed |
| Scheduled jobs | `shine-time-dispatch @ */15 * * * *`, `shine-time-notifications @ * * * * *`, `shine-time-recurring @ 15 2 * * *` — all active |

## Delivery actually works

`net._http_response` shows the worker being called every minute and answering **200** with `{"claimed":0,…,"channels":{"push":true,"email":true}}` — both channels configured, queue empty.

The outbox holds **5 rows, all `SENT` on the first attempt, with no `last_error` anywhere**:

| Channel | Type | Title |
| --- | --- | --- |
| PUSH | RESCUE | Rescue opened automatically |
| EMAIL | RESCUE | Rescue opened automatically |
| EMAIL | RESCUE | Urgent cleaning with bonus |
| PUSH | ESCALATION | No cleaner yet — assign manually |
| EMAIL | ESCALATION | No cleaner yet — assign manually |

So the whole chain ran unattended in production: `st_dispatch_tick` opened rescue on one cleaning and escalated another → the trigger fanned each notification into both channels → the scheduled worker delivered them through the real push service and the real mailbox. One browser is subscribed to push.

Both of those cleanings are still unassigned (`401146`, 12 and 13 October): the dispatch rules behaved exactly as designed, which is also why the notifications existed to deliver.

## The one change that needed review: `verify_jwt = false`

The owner's PR #17 turned off the platform's JWT gate for `st-api`, which was necessary: this project uses the new API key format (`sb_publishable_…` / `sb_secret_…`), those keys are not JWTs, and `pg_net` therefore could not satisfy `verify_jwt` — the scheduled call was failing authentication.

Reviewed and accepted, because the function never relied on that gate:

- Every route except two goes through `context(req)` → `authOnly(req)`, which requires a `Bearer` token and **validates it** with `auth.getUser()` against Supabase, then re-checks that the application account exists and is active.
- The two routes served before that guard themselves: `bootstrap` also calls `authOnly` and can only ever create the very first administrator; `dispatch/outbox` requires `ST_WORKER_SECRET` and refuses with 503 when no secret is configured.
- Role separation is unchanged: `requireRole` on the cleaner and client routers, and the capability table on the admin router (an operations manager keeps `finance: false, access: false`).

What the change does cost is defence in depth: the function is now the only gate, so a future route added above `const ctx = await context(req)` would be open to the internet. `tests/auth-boundary-contract.test.mjs` (new, 5 tests) makes that a build failure: it asserts that **exactly** `bootstrap` and `dispatch/outbox` are served before authentication, that each guards itself, that the secret is checked before any work is done, that nothing touches the database before a route is matched, that the token is validated rather than merely present, and that the role and capability guards are still in place. The reason for the switch is now written in `supabase/config.toml`, in the code at the guard, in `deployment/notifications-schedule.sql` and in `deployment/notifications-setup.md`, with an explicit "do not turn it back on".

## Still open

- **Fix 20** — the Supabase dashboard: Authentication → URL Configuration (only the application's own origins) and leaked-password protection. The only stage 1 item that cannot be done from the repository.
- PR #15 (documentation of the earlier production check) is still open and harmless.
- Stage 2 and stage 3 as listed in `docs/MASTER_PLAN.md`.
