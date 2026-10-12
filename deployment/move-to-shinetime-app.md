# Moving the application from GitHub Pages to shinetime.sk/app

The application already derives its own base path at runtime: `index.php` computes `$base` from the script's directory and publishes it as `window.ST_BASE`, and the service worker takes its scope from `self.registration.scope`. So serving it from `https://shinetime.sk/app/` instead of `https://xdudash.github.io/shine-time555/` needs **no code change** — only the four things below, in this order.

Nothing here is automated on purpose: it switches where your clients and cleaners sign in.

## 1. Upload the frontend to Hostinger

`npm run build && python scripts/package-frontend.py` produces `artifacts/shine-time-frontend.zip` with `artifacts/frontend-checksums.json` beside it. Unpack the zip into `public_html/app/` so that the structure is:

```
public_html/app/index.php
public_html/app/sw.js
public_html/app/assets/…
public_html/app/config/supabase.php
```

`config/supabase.php` holds only the project URL and the publishable key — both are safe in a browser. **Never** put a `service_role` or `sb_secret_…` key there.

Check the checksums after upload (the manifest lists every file with its SHA-256), then open `https://shinetime.sk/app/` and confirm the sign-in screen appears with no console errors.

## 2. Tell Supabase Auth about the new address

Supabase → Authentication → URL Configuration:

- **Site URL:** `https://shinetime.sk/app/`
- **Redirect URLs:** add `https://shinetime.sk/app/*`. Keep the Pages URL only while both are live, and remove it in step 4 — this list is what fix 20 is about, so leave nothing in it that you do not serve yourself.

Password recovery and email confirmation links are built from these values, so a stale entry means a client clicks a link into the old address.

## 3. Point the notification links at the new address

Edge Function secret `ST_APP_URL` → `https://shinetime.sk/app/`. It is what the email button and the notification click target use. Push subscriptions are tied to the **origin**, so everyone who turned notifications on at `github.io` has to turn them on again at `shinetime.sk`; their old subscription stops working and the worker prunes it on the first 404/410. Nothing breaks, but it is worth saying to the cleaners rather than letting them wonder.

## 4. Retire the old address

Once a day or two has passed with the new address in use:

- Remove `https://xdudash.github.io/shine-time555/*` from the Redirect URLs.
- Disable the "Live production application" Pages workflow, or leave the Pages site serving a one-line page pointing at `https://shinetime.sk/app/`. Do not leave a working copy of the application at two addresses: two origins mean two sets of push subscriptions and two service-worker caches, and a client who bookmarked the old one will keep using a build nobody updates.
- Update `deployment/pages-production.json` only if you keep publishing to Pages as well; the file describes the Pages target and nothing else.

## What does not change

- The Supabase project, the database, the Edge Function and every schedule stay exactly as they are. The move is the frontend's address only.
- The build string (`2026-10-12-stage2`) and the frontend/API lockstep are unaffected.
- `index.php` needs no edit: a subdirectory is what `$base` already handles. Serving the application from the domain root would work the same way.
