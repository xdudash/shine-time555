# Production frontend — 2026-09-29

The owner explicitly requested replacing the read-only demo with a usable application. Hostinger's connector required reauthentication and its browser access was blocked. GitHub Pages hosts the static app shell at https://xdudash.github.io/shine-time555/; real authentication, authorization, data, media and realtime remain on the existing Supabase project qbbtroiqioufuucrqair.

This is a frontend-only release, not a database migration or backend replacement. The production st-api v11 source and migration inventory were read on 2026-09-29. The deployed API advertises 2026-09-07-scale1 and accepts that contract. Production-only monthly settlements and property-photo APIs are preserved unchanged. Three existing application users remain in the database; no demo users or records are imported.

`deployment/pages-production.json` pins the server contract separately from frontend release `2026-09-29-live1`. Requests and compatibility checks use the pinned API version; a different server version fails closed. The built archive contains only the public publishable key, real Supabase client and static app assets. No fake role switcher, fixtures, privileged keys or PHP/backend files are deployed.

## Available flow

Existing users sign in with their existing email and password. Their server-managed role chooses the workspace. Objects, instructions, jobs, assignment, cleaner transitions, checklists, evidence, issues, recurring jobs and settlement entries use the real server. The frontend supports mobile dispatch and local checklist intent recovery. Settlement entries record external payments; they do not transfer money.

The separate quality-review workflow from PR #8 is NOT enabled against v11. Its migration and API are not deployed. The app displays completed work as Completed, hides unsupported approval controls and permits v11 settlement recording. Explicit PENDING/REWORK_REQUIRED states always remain blocked from settlement; server authorization remains authoritative. Update the pin and capabilities only after the backend migration is verified and deployed.

## Verification and limits

- Browser regression covers legacy contract negotiation, completed labels and settlement controls while preserving the new review gate when enabled.
- The packaged production browser test uses the real Supabase adapter with synthetic network responses: signed-out isolation, login, session reload, API contract and mobile layout.
- Existing CI exercises real Auth/Storage/Realtime in disposable Supabase, and PostgreSQL concurrency. These are not signed-in acceptance on the production database.
- Publication is checked on the real public URL. A signed-in production write cannot be claimed without an authorized existing session; user credentials are never fabricated or reset.
- Existing Auth recovery redirect settings have not been changed. Recovery-link destination acceptance is still unverified for the new origin.

## Deployment and rollback

The Pages workflow builds and checks `_production` after Verify cleaning platform succeeds on main. `release.json` identifies the exact deployed commit and asset hashes. Demo builds remain separate in `_site` and never deploy through this workflow.

No Hostinger file or existing production DB record is overwritten. Git history is the backup for the prior Pages demo. Roll back the Pages release to the previous commit (read-only demo); do not restore or drop database data. Keep backend deployment separate from this frontend workflow.
