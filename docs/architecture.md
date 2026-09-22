# Architecture and current baseline

## Verified repository inventory (2026-09-22)

| Path | Role | Status |
| --- | --- | --- |
| `index.php` | HTML shell; injects browser config and asset URLs | Present |
| `config/supabase.php` | Project URL, publishable key, function name | Present; publishable key is browser-visible |
| `assets/platform.js` | Compiled React client | Present; source and build recipe missing |
| `assets/platform.css` | Client styles | Present |
| `.htaccess` | Apache route and file access rules | Present |

The PHP shell supplies `window.ST_SUPABASE` and `window.ST_BASE`. The browser calls a configured Supabase Edge Function. This repository does **not** contain that function's source, the SQL schema, RLS policies, storage policies, build source, or deployment automation. Do not infer their correctness from the bundle.

## Target boundaries after source recovery

```
Browser UI (role-scoped screens)
  → typed API client
  → authenticated Edge Function / Supabase APIs
  → domain services (jobs, properties, people, reports)
  → Postgres with RLS and private Storage policies
```

Suggested source layout **only after a reproducible build is recovered**:

```
src/app/                 app shell, routing, localization
src/features/jobs/       job lifecycle and assignment UI
src/features/properties/ property UI and access requests
src/features/people/     roles and team UI
src/features/reports/    completion, photos, issues
src/shared/api/          typed API contracts and client
src/shared/ui/           reusable mobile components
supabase/functions/      versioned Edge Function source
supabase/migrations/     versioned schema and RLS
tests/                   behavior and permission tests
assets/                  generated deployable files
```

This layout is a proposal. Adopt it incrementally, preserving current URL/deploy behavior and comparing generated assets against a known working baseline.

## Core invariants to encode in specs

1. Authorize each read/write on the server and at the data boundary; never trust client role labels.
2. Assignment transitions must be atomic and idempotent; two cleaners cannot accept one exclusive job.
3. Property instructions/photos appear only to a user with an active permitted assignment. Restrict storage object access, not just the listing screen.
4. Every important transition records actor, timestamp, old/new state, and correlation ID without recording access codes.
5. Offline writes have explicit retry behavior and never silently mark a job completed.
6. Changes to database policy require per-role tests and rollback notes.

## Deployment boundary

Deploy only `index.php`, `.htaccess`, `assets/`, and `config/supabase.php` to the PHP web root, preferably `/app`. Apache blocks source documents and internal directories as defense in depth. Confirm server config honors `.htaccess`; do not rely on it when using another web server. Never publish private config, dumps, credentials, or test fixtures.
