# Architecture inventory and provenance

## Recovered source

On 2026-09-22 we located `xdudash/shine-time`, commit `3dc3ecd21661f86ac0d4c834b860617bc9d34a9b` (2026-09-14 18:56 +02:00), and imported its tracked source into this repository. This source contains `assets/`, `scripts/build.mjs`, `package.json`/`package-lock.json`, `supabase/functions/st-api/`, `supabase/migrations/`, `tests/`, `docs/SSD.md`, and deployment documentation. This replaces the earlier assumption that source was unavailable.

The earlier snapshot in baseline commit `5862510c21ee2dd18d21d17ef37809b62bec1ade` contains a separate PHP shell and compiled `assets/platform.js` from 2026-09-14 08:33. It remains in repository history for comparison and rollback analysis. It is **not** silently merged into imported source. The unrelated `ShineTime-source.zip` in Library is the marketing site, not this operations platform.

## Runtime

```
Phone / desktop browser
    ↓
Hostinger PHP shell + JavaScript PWA
    ↓ authenticated requests
Supabase Edge Function st-api
    ↓
PostgreSQL + RLS / private Storage / Realtime
```

The detailed historical system design is in `docs/SSD.md`. Verify its assertions against code, migrations, current infrastructure, and tests before treating them as current production behavior.

## Repositories and releases

- `xdudash/shine-time555`: working source, SSD, issues, CI, and future reviewed changes.
- `xdudash/shine-time`: source of the imported baseline; do not deploy or modify it as a side effect of this project's work.
- Hostinger and Supabase production are separate systems; importing source and passing CI do not deploy code or alter data.
- The old `deploy-production.yml` and GitHub Pages workflow were deliberately excluded on import. Deployment stays manual/gated until environment paths, credentials, backups, and end-to-end checks are confirmed.

## Invariants

Keep five-role authorization at both API and data boundaries, atomic job claims, idempotent commands, signed private media access, finance ledger integrity, and rollback evidence. See `docs/MASTER_PLAN.md` for the gates that must be met before release.
