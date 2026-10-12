# SSD-016 — Stage 1, fix 5: notifications leave the application (push + email)

**Date:** 2026-10-12 · **Scope:** schema + Edge Function + browser + service worker · **API contract:** `2026-10-12-stage1` (unchanged; the routes are additive)
**Approval:** owner decision 7 of 2026-10-12 — "Только пуш и мейл" — plus the channel choice of the same day: **Web Push on our own VAPID keys** and **the domain's own SMTP (Hostinger)**. No third-party notification service, no SMS, no card payments.

## Problem

Every notification lived in `st_notifications` and was only visible to someone who already had the application open. A cleaner does not watch a browser tab, so a marketplace job or a rescue 3 h before the deadline could sit unseen; an owner never learned that a cleaning expired.

## Behaviour

| Role | Change |
| --- | --- |
| Everyone | A **Notifications** card on the cleaner profile, the client profile and admin settings: turn this browser on, send a test notification to yourself, turn this browser off, and two account-wide switches (push, email). The card reads the real state of the browser, not just the stored preference, so a browser that blocked notifications is told so instead of being offered a dead button, and a server without keys says it is not configured. |
| Cleaner | Push for a new marketplace cleaning, a rescue with a bonus and a job assigned by operations. A tap focuses the open application (or opens it) and shows the notification list. |
| Owner / property manager | Email for the things that matter when the app is closed: booking confirmation, rescue, expired cleaning, settlement. |
| Admin, operations manager | The same, plus the staff notifications already written by `st_notify_staff`: a client booking, an escalation 24 h out, a check-in outside the property, an expired cleaning. |

Nothing had to be re-wired to get this: delivery hangs off `st_notifications`, so every existing producer (`st_notify_staff`, `st_job_command`, `st_dispatch_tick`, the API) is delivered without touching it, and a future one cannot forget a channel.

## Design

```
st_notifications (insert)
  └─ trigger st_enqueue_notification
       ├─ PUSH row   when the person wants push and has at least one browser subscribed
       └─ EMAIL row  when the person wants email, has an address, and the type is in emailNotificationTypes
                                  │
pg_cron (every minute) ──net.http_post──▶ st-api  POST dispatch/outbox
                                  │        ├─ st_claim_notifications  (batch, skip locked, SENDING)
                                  │        ├─ Web Push / SMTP
                                  │        └─ st_report_notifications (SENT | PENDING retry | FAILED, prune dead endpoints)
```

- **The database never opens a socket.** `pg_net` only asks the Edge Function to do the work, so all credentials stay in the function's secrets.
- **The worker route is not a browser route.** `dispatch/outbox` is checked against `ST_WORKER_SECRET` with a length-equal comparison *before* the request is turned into a user context, because the scheduled call carries a service-role token and no application user. An unconfigured worker answers 503 rather than running open.
- **Claiming is idempotent-ish by construction**: `for update skip locked` plus a `SENDING` state means two overlapping runs cannot send the same row twice; a row stuck in `SENDING` for 10 minutes is retried, and a row is abandoned as `FAILED` after `notificationRetryLimit` attempts instead of retrying forever.
- **Push is RFC-correct and dependency-free.** VAPID (RFC 8292) ES256 JWTs and aes128gcm payloads (RFC 8188 + RFC 8291) are implemented on WebCrypto in `webpush.mjs`: nothing to fetch at deploy time, and every step is testable in Node.
- **SMTP is spoken directly** (`smtp.mjs`): implicit TLS on 465 or STARTTLS on 587, `AUTH LOGIN`, one message per connection, base64 bodies so no line needs dot-stuffing. The transport is injectable, so the whole conversation is asserted in tests without a socket.
- **A dead browser is forgotten, not retried.** 404/410 from a push service deletes that subscription row; a row whose every browser is gone counts as delivered so it stops cycling.
- **Email is localized** (sk/ru/uk/en) around the operator's own title and message, as plain text plus HTML, with the message escaped into the HTML part.

## Security and privacy

`st_push_subscriptions` and `st_notification_outbox` are RLS-denied to `anon` and `authenticated` and revoked besides; the browser reaches them only through `st_save_push_subscription` / `st_delete_push_subscription`, which bind the row to the caller's own user id. The worker RPCs are granted to `service_role` only. No key material is in the repository: the VAPID private key, the SMTP password, the service-role key and the worker secret are Edge Function secrets, and `deployment/notifications-schedule.sql` is a template with `<SERVICE_ROLE_KEY>` and `<WORKER_SECRET>` placeholders — a test asserts the repository contains no JWT or service key in any of those files. The only key the browser ever sees is the VAPID **public** key, served with `me`.

## Settings

| Key | Default | Meaning |
| --- | --- | --- |
| `emailNotificationTypes` | `["CLIENT_BOOKING","ASSIGNED","RESCUE","EXPIRED","ESCALATION","REVIEW_REJECTED","SETTLEMENT"]` | which types also go by email (push gets everything) |
| `notificationRetryLimit` | `5` | attempts before a row is `FAILED` |
| `notificationBatchSize` | `25` | rows claimed per run |

## Verification

`docs/verification/2026-10-12-notifications.md`.

## Open

- iOS delivers Web Push only to an application added to the home screen; the card says so instead of pretending.
- Delivery against a real push service and a real mailbox is the owner's acceptance step — "Send a test notification" exists for exactly that.
- `sw.js` is generated: it must be rebuilt with `npm run build` on a machine with the toolchain before this merges (`quality.yml` checks it).
