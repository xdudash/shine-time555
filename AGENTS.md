# Shine Time — instructions for coding agents

The canonical working repository is `xdudash/shine-time555`. Read this file, `docs/MASTER_PLAN.md`, `docs/SSD.md`, `docs/architecture.md`, and the relevant issue/spec before editing. The imported source came from `xdudash/shine-time` at commit `3dc3ecd21661f86ac0d4c834b860617bc9d34a9b`. Do not silently merge changes from that repository.

## Purpose and boundaries

The operations platform serves admins, operations managers, cleaners, owners, and property managers. Runtime: Hostinger PHP/PWA frontend; Supabase Auth, PostgreSQL, Storage, Realtime, and Edge Function `st-api`. The baseline commit `5862510c21ee2dd18d21d17ef37809b62bec1ade` is a separate deployment snapshot, not editable source or proof of parity.

Read `docs/STATUS.md` as a dated report, not current production truth. Do not claim a feature works in production without fresh verification.

## Workflow for every request

1. Locate the next eligible checklist item in `docs/MASTER_PLAN.md`, or define one issue-sized item if the user reprioritizes.
2. Inspect the actual code and relevant tests. Record baseline behavior and affected roles. Use `docs/ssd/template.md` for behavior or API changes and record open questions.
3. Implement one vertical slice in a branch; keep schema, RLS, API, UI, tests, and docs consistent. If source behavior differs from spec, update the spec and explain the decision.
4. Run `npm ci`, `npm test`, `npm run build` and narrower relevant tests. For SQL, API, or role changes add focused authorization and concurrency tests. Report commands and actual output.
5. Open a focused PR describing behavior, security impact, deployment, rollback, and remaining gaps. Update the master plan only after evidence is attached.

## Security and correctness

- Browser labels and hidden controls are not authorization. Check actor, resource scope, state, and ownership at the API and RLS/storage boundary.
- No service-role key, DB password, access code, customer data, production photo, token, or secret in commits, issue bodies, fixtures, logs, or prompts.
- Protect `ADMIN`, `OPERATIONS_MANAGER`, `PROPERTY_MANAGER`, `OWNER`, `CLEANER`, unassigned cleaner, and anonymous access in tests as applicable.
- Assignment and completion transitions must be atomic, replay safe, and observable. Never re-run baseline migrations on production to resolve a local failure.
- Migrations and Edge Function deployment require explicit environment targeting, backups, acceptance checks, and rollback procedure. A commit must not trigger production deployment from this repository without a separate reviewed setup.
- Preserve finance ledger exactness and audit history; do not silently rewrite recorded payments.
- Validate cleaner flows at mobile widths and preserve SK/UA/EN translations.

## Source organization

`assets/` contains editable modules and generated bundles. Use `scripts/build.mjs`, not hand edits to generated outputs. `supabase/functions/st-api/` and `supabase/migrations/` hold backend source. `tests/` contains automated checks. the repository history preserves imported deployment evidence; do not deploy it by default.

Always distinguish verified repository facts, historical documentation, assumptions, and production observations.
