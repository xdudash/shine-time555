# Shine Time Operations

This is the working repository for incremental development. Begin with [the master plan](docs/MASTER_PLAN.md), [agent instructions](AGENTS.md), and [SSD workflow](docs/ssd/README.md). Source was imported from `xdudash/shine-time` commit `3dc3ecd21661f86ac0d4c834b860617bc9d34a9b`; the recovered deployment snapshot is preserved in the repository history. Database and Edge Function deployments remain manual and gated. The static production frontend is deployed after CI, under the explicit release authorization of 2026-09-29.

The public GitHub Pages URL now hosts the authenticated production frontend connected to the existing Supabase project. See [production deployment](docs/production-pages.md). Synthetic previews remain available locally through `scripts/build-preview.mjs`.

Cleaning operations platform: Hostinger frontend, Supabase backend.

## Components

- Hostinger `/app`: PHP entry page, mobile PWA, static assets.
- Supabase Auth: administrator, operations manager, cleaner, owner and property manager.
- Edge Function `st-api`: authenticated API and role-scoped responses.
- PostgreSQL: transactional assignment and completion, recurring jobs, exact financial records.
- Private Storage: signed photo/video reports with verified finalization.
- Realtime: scoped invalidation events and periodic reconciliation.

## Verification

Run `npm ci`, `npm test`, and `npm run build`.
GitHub Actions also starts native PostgreSQL 17 for concurrent job-command tests
and checks financial aggregates against 100,000 synthetic jobs.

See [verification status](docs/STATUS.md) and [deployment procedure](deployment/README.md).
Production deployment is separate from uploading this repository. Existing customer
data must be preserved; do not reinstall the baseline schema on the production database.
