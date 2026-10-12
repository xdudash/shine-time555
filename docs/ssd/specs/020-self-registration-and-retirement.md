# SSD-020 — Stage 3: client self-registration, retiring the prototype, moving the address

**Date:** 2026-10-12 · **Scope:** schema + Edge Function + browser, plus two deployment procedures · **API contract:** `2026-10-12-stage2` (the routes are additive)
**Approval:** owner decision 5 of 2026-10-12 (self-registration with owner approval) and audit fixes 27 and 28.

## Self-registration with your approval

A client signs up with Supabase Auth from the sign-in screen ("I have properties and want an account"), and `st-api` calls `st_request_client_account`, which creates their `st_users` row as an `OWNER` that is **not active** plus a row in the new `st_account_requests`. Nothing is visible to them until an administrator approves it.

Why inactive rather than a new restricted role: `context()` in `st-api` already refuses an inactive account on **every** route with "This account is not activated by Operations". The inactive flag is therefore the whole gate, enforced in the one place every request passes through, and no route had to learn about a half-member.

| | Behaviour |
| --- | --- |
| The form | says before it is sent that accounts are checked by hand and an email follows; asks for name, email, a 12-character password, phone, company, city, property count and an optional message |
| Asking twice | returns the current standing (`PENDING`, `REJECTED` or `ACTIVE`) instead of queuing a second row or a second account |
| An email that already has an account | is told to sign in or use "Forgot password?", not left guessing |
| Email confirmation on | the request is made the moment they confirm; the form says so |
| You | **Clients → Account requests**: who is waiting, with everything they wrote. Approve takes an optional note; reject **requires** a reason. Approving activates the account, creates the client account with their company name and notifies them. Rejecting records the reason and leaves the sign-in dead. |
| Who may decide | the administrator only — an operations manager is refused in SQL (`Forbidden: accounts require administrator`), because letting someone in is an account decision, like creating a manager |
| Turning it off | `selfRegistrationOpen` in Settings, no deployment needed |

`account/request` is the third route served before `context(req)`, and `tests/auth-boundary-contract.test.mjs` now asserts why that is safe: it calls `authOnly(req)`, takes the identity from the **token** (`authUser.id`, `authUser.email`) rather than from the body, cannot be asked for a role, and the account it creates is inactive.

## Fix 27 and 28 — retiring the imported prototype

`deployment/retire-legacy.sql` is a one-time production procedure, deliberately not a migration, because it drops things and wants your eyes on the output. It was written against the live database, which is where its one real finding came from:

> `profiles` is still being written — not by the application, but by `on_auth_user_created` on `auth.users`, which calls `private.handle_new_user()` and inserts into `public.profiles`. **Dropping `profiles` first would break every new sign-up**, including the self-registration above.

So the order is: confirm the tables are still empty (they were: everything 0 rows except `organizations` 1 and `profiles` one row per auth user) and that no `st_*` table references them; drop the trigger and function; **prove a sign-up still works**; then drop the twelve prototype tables; then check the storage buckets and delete an empty prototype bucket if one remains; then delete the `site-session` Edge Function from the dashboard. Nothing in the repository calls `site-session` — `grep -rn site-session` over the application finds only documentation.

The file keeps the trigger's definition reachable (it is quoted in the verification notes) so it can be put back if anything surprises you mid-way.

## Moving to shinetime.sk/app

`deployment/move-to-shinetime-app.md`. No code change is needed: `index.php` already derives `window.ST_BASE` from its own directory and the service worker takes its scope from the registration. What the move does need is the frontend uploaded to `public_html/app/`, Supabase Auth's Site URL and Redirect URLs pointed at the new address (which is also fix 20's housekeeping), `ST_APP_URL` updated so notification links lead there, and the old address retired afterwards — with the warning that push subscriptions are per origin, so everyone re-enables notifications once.

## Verification

`docs/verification/2026-10-12-stage3.md`.

## Open

- The retirement and the address move are procedures for you to run; nothing in them is automated, and the application works unchanged until you do.
- Fix 20 remains your two switches in the Supabase dashboard (Redirect URLs — which step 2 of the move also covers — and leaked-password protection).
