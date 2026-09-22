# Incremental roadmap

This is a proposed order, not a claim of completed functionality. Each phase closes with a reviewable, independently verified artifact.

| Phase | Deliverable | Exit evidence |
| --- | --- | --- |
| 0 — Repository baseline | Inventory, agent rules, SSD templates, CI checks | Repo tree, passing CI, documented missing components |
| 1 — Recover source | Locate original React source, build config, lockfile, Edge Function source, schema/policies | Clean build reproduces deployable assets; production behavior sampled before replacement |
| 2 — Contract and auth inventory | Document API operations, roles, RLS, Storage, job state machine | Per-role access matrix and failing tests for any gap |
| 3 — Assignment reliability | Atomic accept/assign/reassign, idempotent retries, cleaner visibility | Concurrency and permission tests; observable job transitions |
| 4 — Property guidance | Photos, entry instructions, directions after authorized acceptance | Authorized/unauthorized and revocation tests |
| 5 — Operations | Recurring jobs, exception handling, issues, reports, notifications | Workflow tests and operational metrics |
| 6 — Scale and release | Load simulation, monitoring, staged deploy/rollback | Measured 50+ user scenario and recovery drill |

## Next slices

1. Locate the source repo and exact build command; do not generate a fake source tree from the minified bundle.
2. Locate `st-api` function and Supabase schema, then document what each role may actually read and mutate.
3. Select one broken workflow with a reproducible example and write SSD-001 for it.

Use GitHub issues to track each slice. Move the order when evidence changes, and record the reason in the affected issue.
