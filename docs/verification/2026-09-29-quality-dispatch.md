# Quality, dispatch and checklist recovery — release evidence

Source base: `de39750`; implementation branch: `feat/mobile-operations-complete`.
Release protocol: `2026-09-28-quality1` in PHP configuration, Edge API and service-worker cache. Old browser versions are rejected by the new API; deploy matching artifacts together after the migration.

## Implemented behavior

- Filtered daily queues and consistent summary counts at 320/390/430px and desktop.
- Cleaner submission becomes PENDING quality review; manager approval or documented rework uses request ID and expected version. Historical COMPLETED jobs migrate APPROVED without rewriting money.
- Actual settlements require approval; report shows accrued earned totals, waiting-review balances and approved payable balances separately.
- Checklist-only drafts store IDs/booleans/revision/time for up to 24 hours. No keys, addresses, notes or media are cached by this module. Fresh authorization is checked during replay; acceptance, completion and money are never queued.
- Offline draft support preserves edits on an open loaded job and restores them after reconnect/reload once the job can be fetched. It does not provide an offline private job-detail cache or persistent media upload queue.

## Review and regressions

Independent review identified two important integration defects. Both were reproduced in browser tests before correction:
1. New opposite checkbox intent during an in-flight PATCH was deleted by reconciliation against a stale UI snapshot. Painting now only reads drafts; synchronization owns acknowledgement and follow-up replay.
2. Header KPIs retained unfiltered values. Every filter render now updates summaries, queue counts and rows together.

The prior fixed-time live-update test was timing-dependent under parallel load; it now waits for the actual refresh start/completion events.

## Verification commands

- `npm ci` / pinned lockfile installation.
- `npm test`: full Node/PGlite/domain/authorization suite; final result recorded in PR.
- `npm run build`, `npm run check`, `git diff --check`.
- `npm run test:browser`: old lifecycle regression suite, new workspace suite and built synthetic preview across five roles. Includes pending report payment guard, opposite checklist edits while PATCH is held, and viewport checks.
- `node_modules/.bin/php-wasm-cli -l index.php` and configuration lint.
- `node scripts/benchmark-history.mjs`: synthetic history benchmark; environment and measured results in generated JSON.
- `python scripts/package-frontend.py`: checksummed frontend package.
- GitHub verification additionally runs `scripts/test-concurrency.mjs` against disposable native PostgreSQL. Includes 50 claims / one winner, 50 completion retries / one event, opposing review decisions / one winner, 50 review retries / one event and 50 independent assignments.

PGlite serializes local sessions; it is not proof of native concurrency. Browser API fixtures prove presentation and request flow, not production Auth/Storage. Public preview rejects mutations and uses fictional records.

## Rollout and rollback

1. Reconcile existing environment drift; identify a separate staging target and migration head.
2. Back up database, Auth and Storage according to their distinct restoration procedures.
3. Apply additive migration `20260928155407_quality_review.sql` to staging and verify historical rows/settlements.
4. Deploy matching st-api and frontend; run actual five-role acceptance including media and review/payment flow.
5. Release production only under the repository's explicit environment/backup/review gate.
6. A frontend-only rollback must retain a working review UI. The new settlement gate remains in the database; do not remove approval data or silently bypass the gate. Prefer forward-fix with preserved audit history.

No production database, Auth, Storage, Hostinger or production deployment settings changed during this source work.

## Local results — 2026-09-29

- Full suite: **140/140 passed**, 0 failures, ~128 seconds in this workspace.
- Build/check/PHP lint: passed. API bundles with esbuild (Deno npm imports external).
- Three browser suites: passed, including five preview roles and latest-intent race regression.
- Preview safety scan: passed. Frontend package: 58 files.
- Synthetic 100,000-job benchmark: exact full-history sums and bounded 100-row page passed; report 6,570 ms, finance report 3,025 ms in isolated PGlite while other checks ran. These are not production p95 figures or a passing production performance target.
- Native PostgreSQL concurrency: awaiting GitHub CI at publication time.
