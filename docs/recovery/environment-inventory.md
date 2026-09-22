# Read-only environment inventory — 2026-09-22

## Confirmed Supabase state

- Project `shine-time-operations`, reference `qbbtroiqioufuucrqair`, region `eu-central-1`, status `ACTIVE_HEALTHY`, PostgreSQL 17.
- Edge Function `st-api`: `ACTIVE`, version **11**, JWT verification enabled. A separate `site-session` function also exists.
- Migration history contains 22 entries. Latest three are `20260909150213_monthly_settlements`, `20260909220128_property_reference_photos`, preceded by `20260908094112_enable_recurring_schedule`.
- The imported repository migration directory does **not** contain the monthly settlements or property-reference-photo migrations. Its historical `docs/STATUS.md` references an older `st-api` version. Therefore source and production are not in sync.
- All 37 returned tables in the `public` schema report RLS enabled. This metadata does not verify policy correctness or per-role access.

## Still unverified

- Exact deployed Edge Function source/hash parity with imported source.
- SQL text and ownership of production-only migrations.
- Current Hostinger frontend artifact/version and actual web root.
- Staging project, backup/restore rehearsal, and responsible release operator.

## Release constraint

**Do not run `supabase db push`, reapply baseline SQL, deploy this repository's `st-api`, or upload this repository's frontend to production.** First recover or diff production-only migrations and function source, compare frontend variants, and verify staging/rollback. Read-only inventory did not mutate production data.
