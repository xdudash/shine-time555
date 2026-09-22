# Shine Time — Phase 1 Security Hardening

Date: 2026-09-14

This document is the executable checklist for the first hardening phase from `docs/SSD.md`.

## Completed in repository

- Added a shared, bounded request-id validator in `supabase/functions/st-api/security.mjs`.
- Added one explicit managed-account password policy: minimum 12, maximum 256 characters.
- Added regression tests for request IDs and role-based response projection in `tests/security-regression.test.mjs`.
- Added `supabase/migrations/20260914_security_phase1.sql`:
  - forces `st-cleaning-media` private;
  - revokes direct INSERT/UPDATE/DELETE/TRUNCATE from `anon` and `authenticated` on backend domain tables;
  - keeps only the intentionally exposed authenticated read surface explicit.

## Must be verified before production deployment

### 1. Identity and sessions

- [ ] Every API mutation requires a valid Supabase Auth bearer token.
- [ ] `st_users.auth_user_id` is unique and maps to exactly one active application user.
- [ ] Disabled application users cannot call protected routes.
- [ ] JWT validation is performed server-side; no role is trusted from request JSON.
- [ ] Password reset/create flows are tested against the same 12-character policy.

### 2. Authorization / IDOR

Test every resource with at least two accounts:

| Resource | Owner | Property manager | Cleaner | Operations | Admin |
|---|---:|---:|---:|---:|---:|
| Own booking | RW | RW* | R assigned | RW | RW |
| Foreign booking | DENY | DENY | DENY | policy | RW |
| Own object | RW | RW linked | DENY | policy | RW |
| Foreign object | DENY | DENY | DENY | policy | RW |
| Finance | own/report | own/report | own earnings | report | RW |
| User administration | DENY | DENY | DENY | managed scope | RW |

`*` Property-manager access must always be checked through `st_manager_properties`.

### 3. Mutation integrity

- [ ] No generic job PATCH can bypass the job command/state machine.
- [ ] Assignment, rescue, accept, status, completion and cancellation are transactional.
- [ ] Every idempotent command has a server-bounded request ID.
- [ ] Duplicate retries produce one business event, not multiple events.
- [ ] Concurrent claims have exactly one winner.

### 4. Media

- [ ] Bucket is private after migration.
- [ ] Upload tickets expire and are bound to actor + job.
- [ ] Finalize validates actual object bytes, not only client MIME.
- [ ] Image dimensions/pixel count and decompression-bomb limits are enforced.
- [ ] Signed URLs are short-lived and never logged.
- [ ] Orphaned upload cleanup is monitored.

### 5. Finance

- [ ] Client-supplied IDs are checked against the actor's permitted scope.
- [ ] Amounts are finite and normalized to the chosen currency precision.
- [ ] Corrections are append/reversal operations rather than destructive edits.
- [ ] Settlement operations are idempotent and auditable.

### 6. Production proof

- [ ] Record deployed Git SHA and Edge Function version.
- [ ] Apply database migration in staging first.
- [ ] Run the full CI suite.
- [ ] Run five-role staging smoke test.
- [ ] Verify RLS with real `anon` and `authenticated` sessions.
- [ ] Verify private Storage with an unauthenticated request.
- [ ] Confirm backup + restore procedure.
- [ ] Confirm rollback procedure.

## Gate

Phase 1 is **not production-complete** until all unchecked verification items above have evidence in CI, staging, or deployment records. The code changes in this phase are deliberately additive; the next high-risk implementation is to make the password/request-id helpers authoritative in the API mutation paths and then close the finance/IDOR matrix with integration tests.
