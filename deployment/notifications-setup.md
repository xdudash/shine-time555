# Notification delivery — what to set before the first message is sent

Nothing in this repository contains a key. All of it goes into the Edge Function
secrets (Supabase → Edge Functions → `st-api` → Secrets) and into the filled-in
copy of `deployment/notifications-schedule.sql`, which is pasted straight into
the SQL editor.

Until `ST_WORKER_SECRET` is set, the worker route answers 503 and nothing is
sent; the rest of the application is unaffected.

## 1. VAPID keys for Web Push

Generate the pair yourself, so the private key never travels through a chat or a
repository. Any machine with Node 18+ will do:

```sh
node -e "crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign']).then(async k=>{const pub=Buffer.from(await crypto.subtle.exportKey('raw',k.publicKey));const jwk=await crypto.subtle.exportKey('jwk',k.privateKey);console.log('VAPID_PUBLIC_KEY=',pub.toString('base64url'));console.log('VAPID_PRIVATE_KEY=',jwk.d)})"
```

Set as function secrets:

| Secret | Value |
| --- | --- |
| `VAPID_PUBLIC_KEY` | the printed public key (the browser receives this one; it is not sensitive) |
| `VAPID_PRIVATE_KEY` | the printed private key — **never** in a commit, an issue or a message |
| `VAPID_SUBJECT` | `mailto:info@shinetime.sk` (a contact the push service can reach) |

Keep the pair: changing it invalidates every existing browser subscription, and
everyone has to turn notifications on again.

## 2. The mailbox (Hostinger SMTP)

| Secret | Value |
| --- | --- |
| `SMTP_HOST` | `smtp.hostinger.com` |
| `SMTP_PORT` | `465` (TLS from the first byte; `587` also works and is upgraded with STARTTLS) |
| `SMTP_USER` | the full mailbox address, e.g. `info@shinetime.sk` |
| `SMTP_PASSWORD` | that mailbox's password |
| `SMTP_FROM` | the address recipients see (defaults to `SMTP_USER`) |
| `SMTP_FROM_NAME` | `Shine Time` |

Check in the Hostinger panel that SPF and DKIM are set for the domain,
otherwise mail from an unfamiliar sender lands in spam.

## 3. The application link and the worker secret

| Secret | Value |
| --- | --- |
| `ST_APP_URL` | where the application lives, e.g. `https://xdudash.github.io/shine-time555/` (later `https://shinetime.sk/app`) — used in the email button and in notification clicks |
| `ST_WORKER_SECRET` | a long random string, generated with `openssl rand -base64 32`, known only to the function and to the scheduled job |

## 4. The schedule

> **Do not set `verify_jwt = true` for `st-api`.** This project uses the new
> API key format (`sb_publishable_…` / `sb_secret_…`), and those keys are not
> JWTs, so the platform's gate rejects the scheduled call with 401. The
> function authenticates every request itself (`authOnly()` for user routes,
> `ST_WORKER_SECRET` for the outbox route) — `tests/auth-boundary-contract.test.mjs`
> is what keeps that true.


Deploy `st-api` first, then take `deployment/notifications-schedule.sql`,
replace `<SERVICE_ROLE_KEY>` (Project settings → API → `service_role`) and
`<WORKER_SECRET>` (the same value as `ST_WORKER_SECRET`), and run it once in the
SQL editor. It installs `pg_net` and registers `shine-time-notifications` to ask
the function to drain the outbox every minute.

## 5. Check it works

1. Sign in, open the profile (or admin → Settings), **Turn on notifications in
   this browser**, then **Send a test notification**. This path does not use the
   schedule, so it proves the VAPID keys on their own.
2. Make any booking as a client. Within a minute the staff accounts get a push,
   and the email-worthy types arrive by mail.
3. If something stays unsent:
   ```sql
   select status, count(*) from public.st_notification_outbox group by status;
   select id, channel, status, attempts, last_error from public.st_notification_outbox order by id desc limit 10;
   select id, status_code, left(coalesce(content,''),200) as body, created from net._http_response order by id desc limit 5;
   ```
   `last_error` carries the push service's or the mail server's own words. A row
   stops after `notificationRetryLimit` (5) attempts; 403 in `net._http_response`
   means the worker secret does not match, 503 that the secrets are not set.

On iPhone, Web Push only works for the application added to the home screen.
Email needs nothing of the sort.
