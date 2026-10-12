# Verification — notifications outside the application (push + email)

**Date:** 2026-10-12 · **Branch:** `feat/stage1-notifications` · **Spec:** `docs/ssd/specs/016-notification-delivery.md`
**Not deployed.** Nothing here has been applied to `qbbtroiqioufuucrqair`; the steps are in `docs/MASTER_PLAN.md` and in the pull request.

## Environment limits of this run

The npm registry is unreachable from the development container, so `npm ci` and `npm run build` (esbuild) cannot run here. **`sw.js` therefore still carries the previous service worker**: the push and notification-click handlers are in `assets/service-worker-entry.mjs` and must be bundled with `npm run build` on a machine with the toolchain before this merges — `quality.yml` fails on `git diff --exit-code -- sw.js` until that is committed. The source bundles cleanly (checked with bun as a syntax and resolution check only, not as the committed output). The database suites ran against the local PostgreSQL 16 server through a throwaway driver shim in `node_modules`, not PGlite; CI runs them on PGlite.

## 1. SQL — the outbox rules on real PostgreSQL

Full migration chain from scratch, including `20261012120000_notification_delivery.sql`: `chain-ok`.

Scenarios: `tests/sql/notification-scenarios.sql`, exit code 0, 12 sections.

| # | Scenario | Observed |
| --- | --- | --- |
| 1 | A notification for someone with no subscription, type not in the email list | 0 outbox rows — nothing is queued that cannot be delivered |
| 2 | Same notification after the browser subscribes | one `PUSH` row, `PENDING` |
| 3 | An email-worthy type (`RESCUE`) | both a `PUSH` and an `EMAIL` row |
| 4 | The person turns push off | only the `EMAIL` row is queued (`EMAIL` 2, `PUSH` 1 across the two rescues) |
| 5 | A deactivated user with a subscription | 0 rows — a disabled account is never messaged |
| 6 | Two worker runs in a row | first claim 4 rows, second claim 0; all 4 left `SENDING` |
| 7 | The shape the worker receives | push row carries `subscriptions[]` with endpoint/p256dh/auth and the recipient language (`ru`), `email: null`; email row carries `email`, `recipientName`, `language`, no subscriptions |
| 8 | Reporting a mixed batch | `{"sent":2,"failed":1,"prunedSubscriptions":1}` — the failed row returns to `PENDING` with its error text, the dead endpoint row is deleted (2 subscriptions → 1) |
| 9 | A row that keeps failing, limit 2 | `PENDING` → claim → fail → claim → fail → `FAILED`, attempts 2, and a further claim returns 0 — no infinite retry |
| 10 | A row stuck in `SENDING` for 30 minutes | reclaimed (4) — a crashed worker does not strand messages |
| 11 | The browser unsubscribes | 1 row removed; a later notification queues nothing |
| 12 | Table exposure | both tables carry a `false`/`false` policy for `anon, authenticated`, and `has_table_privilege('authenticated', …, 'select')` is `f` for both |

## 2. Node suites

`node --test tests/*.test.mjs` → **173 tests, 173 pass, 0 fail** (was 146 before this slice; 27 new).

**Push crypto** (`tests/webpush.test.mjs`, 10 tests)
- HKDF matches **RFC 5869 test case 1** byte for byte, so the key schedule is not merely self-consistent.
- A payload encrypted by our code is decrypted back to the plaintext by a decryption written separately in the test straight from RFC 8291 §3.4 and RFC 8188 §2 (`WebPush: info\0`, `Content-Encoding: aes128gcm\0`, `Content-Encoding: nonce\0`), and the body length is exactly `16+4+1+65+len+1+16`.
- Another browser's keys cannot decrypt it; the salt and the whole body differ on every call.
- An oversized payload is refused rather than truncated.
- The VAPID header is a real ES256 JWT: verified with the public key, `aud` is the push service **origin** (not the full endpoint), `sub` is ours, `exp` is capped.
- Request headers are what push services require (`aes128gcm`, `application/octet-stream`, `TTL`, `Urgency`, `Authorization: vapid t=…, k=…`).
- 2xx → sent, 404/410 → gone, everything else → retry; across three browsers one live endpoint means delivered, the 410 comes back to be pruned, and the decrypted payload is the JSON the service worker reads.

**SMTP** (`tests/smtp.test.mjs`, 9 tests) — ASCII headers stay readable and others become RFC 2047 encoded words; base64 bodies are ≤76-character lines with no line starting with `.`; the multipart message has both parts with the right headers and terminator; the full conversation is asserted command by command (`EHLO`, `AUTH LOGIN`, user, password, `MAIL FROM`, `RCPT TO`, `DATA`, body + `\r\n.`, `QUIT`); a multi-line greeting is read as one reply and STARTTLS upgrades the socket **before** `AUTH`; a rejected password (535), a refused recipient (550), a dropped connection and a server without `AUTH LOGIN` all raise with the server's own text; `sendMail` always closes the transport and **never writes the password in clear**; the email is localized in all four languages, escapes the message into the HTML part and links to the app; `deliverEmail` returns a per-row failure instead of throwing.

**Worker** (`tests/notification-worker.test.mjs`, 8 tests) — configuration and fallbacks from the function secrets; the worker secret is compared whole and an **unset** secret never matches; an empty outbox causes no send and no report round trip; a mixed batch sends each row on its own channel, reports all four outcomes, prunes a 410 and writes the email in the recipient's language; an unconfigured channel fails only its own rows while the other channel still delivers; a failing mail server does not stop the batch. Two contract tests assert the guard sits **before** `context(req)`, that the subscription RPCs are used, that no VAPID private key or SMTP password is referenced in the browser bundle, that the migration revokes the tables and grants the worker RPCs to `service_role` only, and that no JWT or service key is committed in the migration, the worker or the schedule template.

## 3. Browser suites

`tests/usability-browser.mjs` gains **PASS notifications: push subscribe, test, channel toggles, unsubscribe, blocked and unconfigured states** at 390 px: the card offers the enable button, subscribing sends `endpoint`/`p256dh`/`auth`/`userAgent` and asks the browser with `userVisibleOnly: true` and a **65-byte** application server key, the card then reports the browser is subscribed, the test button calls the API once, unchecking the email switch stores `{email:false}`, turning the browser off calls `DELETE account/push` **and** drops the browser's own subscription, a browser with permission `denied` is told so and gets no dead button, and a server without keys says it is not configured. No page errors, no horizontal scroll.

All other browser suites pass unchanged: `browser` (7 blocks), `workspace-browser` (4), `usability-browser` (12 total), `preview-browser`, and the production bundle (`Built authenticated production frontend for st-api v14 (2026-10-12-stage1)` → `PASS production bundle: …`).

## 4. Translations

The ru/uk/sk crawl over every screen still reports only the three intentional strings (`Email`, `IČ DPH`, `🧭 Google Maps`); 16 new labels per language were added for the notification card.

## 5. Not verified here

- **Real delivery.** No message has been sent to a real push service or mailbox from this container (its network is restricted to package registries and GitHub). The first real send happens when the owner uses "Send a test notification" after deployment.
- **pg_cron + pg_net.** The migration does not install `pg_net`; `deployment/notifications-schedule.sql` does, and that it is registered can only be confirmed in production (`select jobname, schedule, active from cron.job` and `select status_code from net._http_response order by id desc limit 5`).
- iOS Web Push needs the application on the home screen; untested on a device.
