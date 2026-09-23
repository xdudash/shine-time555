# Read-only environment inventory — refreshed 2026-09-23

## Confirmed Supabase state

- Project `shine-time-operations`, reference `qbbtroiqioufuucrqair`, region `eu-central-1`, status `ACTIVE_HEALTHY`, PostgreSQL 17.
- Edge Function `st-api`: `ACTIVE`, version **11**, JWT verification enabled. A separate `site-session` function also exists.
- Migration history contains 22 entries. Latest three are `20260909150213_monthly_settlements`, `20260909220128_property_reference_photos`, preceded by `20260908094112_enable_recurring_schedule`.
- The imported repository migration directory does **not** contain the monthly settlements or property-reference-photo migrations. Its historical `docs/STATUS.md` references an older `st-api` version. Therefore source and production are not in sync.
- All 37 returned tables in the `public` schema report RLS enabled. This metadata does not verify policy correctness or per-role access.

## Still unverified

- Reconciliation of recovered Edge source with imported source; confirmed different, see below.
- Upgrade tests for recovered production-only migrations; SQL definitions were retrieved read-only on 2026-09-23.
- Current Hostinger frontend artifact/version and actual web root.
- Staging project, backup/restore rehearsal, and responsible release operator.

## Release constraint

**Do not run `supabase db push`, reapply baseline SQL, deploy this repository's `st-api`, or upload this repository's frontend to production.** First recover or diff production-only migrations and function source, compare frontend variants, and verify staging/rollback. Read-only inventory did not mutate production data.

## Fresh source comparison — 2026-09-23

Read-only `get_edge_function(st-api)` returned 13 production files. The deployed function delegates from index.ts to runtime/auth/jobs/cleaner/client/admin/router modules and property-photos.mjs. The repository instead has a monolithic index.ts; all five common helper/source files differ. Both report `2026-09-07-scale1`, so the compatibility string alone is not a parity check.

Recovered migration definitions confirm:
- `monthly_settlements`: service-only batch table and admin-checked monthly aggregation / atomic batch allocation functions, with request-id replay and ordered job locks.
- `property_reference_photos`: private property-guide bucket, object-photo table, size/type limits and restrictive Storage policy blocking browser access.

Neither definition was executed. Production-only features must be reconciled and tested before replacing the backend or the existing frontend. Source files were inspected without fetching customer records or media.

Security advisor follow-up: verify the settlement immutability trigger's search_path, review callable security-definer grants, and evaluate leaked-password protection. RLS-enabled tables without browser policies are not automatically defects: service-only tables are intentionally inaccessible.

Production Edge source SHA-256 inventory (retrieval evidence; not a release manifest):

| File | SHA-256 |
| --- | --- |
| admin.ts | `edaff1dc5aed6943eb4c7a3ab97ad0fcbdfe689b25b211a4f51d36646b119d27` |
| auth.ts | `07fb1af13ae681e66695a982baf3ff8d6127419aa3496ac09e6c147033f7588e` |
| cleaner.ts | `1e3cb694584fffb6d7fd459517e9dfcca080ed59ea98a4c5a7c0adbc2f9f9003` |
| client.ts | `36662da1585d8e2ca34f6279c424f35df91a0135e056757dbdb0bcfa54ebb390` |
| index.ts | `f03fe8a80afa882ea629f757f959b26f9f06ad8d2422ac90e9327b305ece4240` |
| jobs.ts | `d7a9693b8c24ccee172681e16c0784e832f48aae6e6c81968514746059154812` |
| logic.mjs | `8636e2053d42521ad10b530e13b2dbf912bdbd7c5347e1bbfbae8df12751210e` |
| media.mjs | `a75d3e8fe7503f9e43be83cdddfe90c7adeb4169ab574d1947cbb4ec32aae014` |
| operations.mjs | `5d4a2ce271a09ae480ddf96e922da216f406531390c1e98a5c60bbdce038184d` |
| property-photos.mjs | `ce19af481e434ab5ea786922ddbc4fe494983e9452b84c05bf7168ba5a741af2` |
| router.ts | `a883bf1d0476dd4f34190778622b0a9ac13a394f1d1d51557c0a20a69eca78c4` |
| runtime.ts | `ebc5b873b83e1e198e41098e02e48369ed68ec518229461eb0081ba1524195d0` |
| security.mjs | `b158520b87226859c581969ddcccfb47dc2c84bcf974186262ca084f3d587700` |
