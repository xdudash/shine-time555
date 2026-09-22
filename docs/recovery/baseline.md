# Imported source baseline — 2026-09-22

Source import: `xdudash/shine-time` commit `3dc3ecd21661f86ac0d4c834b860617bc9d34a9b`; target `shine-time555`. Local runtime: Node v24.19.0, npm 11.9.0. No production or staging deployment occurred.

## Local evidence

- `npm ci --no-audit --no-fund`: installed 106 packages successfully.
- Initial `npm test`: two contract tests failed. One asserted the wrong JavaScript variable name for an existing checklist endpoint (`jobId` vs `id`). The other asserted a brittle escaped string in a generated live-update bundle. Production code was unchanged; the latter test now calls the actual `staticCacheAllowed` function against same-origin, cross-origin, and forbidden paths.
- After these test-only corrections, `node --test tests/cleaner-lifecycle-contract.test.mjs tests/operations-runtime-contract.test.mjs`: 8/8 passed.
- `npm test`: 103/103 passed, zero skipped, 28.8 seconds.
- `npm run build`: succeeded, built auth client, live coordinator, and service worker.
- `python scripts/package-frontend.py`: succeeded, packaged 53 frontend files.
- `node --check assets/app.js`: succeeded.
- PHP CLI is not installed in the local environment, so PHP syntax and authenticated end-to-end journeys require CI/staging verification.

## Limits

These are local source tests using synthetic data. They do not prove the currently deployed Hostinger files or Supabase project match this source. The archived React bundle has a different HTML shell; see `parity-matrix.md`. The imported deployment automation is disabled in this repository.
