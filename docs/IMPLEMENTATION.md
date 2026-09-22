# Shine Time scale implementation plan

> For agentic workers: Use superpowers:subagent-driven-development for bounded tasks with independent review. User approved full autonomous implementation on 2026-09-06.

**Goal:** Preserve the existing platform while delivering secure, consistent operations, usable mobile flows, financial controls and reproducible validation.
**Architecture:** Keep Hostinger shell and Supabase data identity. Add transactional commands, modular domain code and stable UI state. Ship additive migrations and a rollback-aware release.
**Tech Stack:** JavaScript modules, TypeScript Edge Function, PostgreSQL, Supabase, PHP shell.
**Spec:** docs/SPEC.md.

## Global constraints
- Preserve existing data, five roles, existing scenarios and SK/UK/EN/RU localization.
- No production test records or destructive migrations. Validate on isolated local PostgreSQL.
- Never expose object access secrets on marketplace or internal financial fields to unauthorized roles.
- Object windows override global defaults. Europe/Bratislava service dates.
- Report proven results separately from target load; no unsupported production-ready claim.
- Ruling: Inline controller plus bounded sequential implementation agents; no repeated approval questions.

## Task 1: Reliable domain and commands
Files: supabase/functions/st-api/{logic.mjs,index.ts,security.mjs}; supabase/migrations/*operations_commands.sql; tests/domain.test.mjs; tests/commands.test.mjs.
Interfaces: availableBookingSlots receives object and per-cleaner availability; marketplaceForCleaner returns safe offers. SQL command st_job_command(p_actor_id bigint,p_job_id bigint,p_action text,p_body jsonb,p_request_id text) returns st_jobs. Only service_role can execute. Controller integrates after schema tests.
- [ ] Add regression tests: `assert.ok(availableBookingSlots(twoCleanerFixture).includes('10:00'))`; evening offer feasible; secret fields absent; unavailable and past windows rejected.
- [ ] Run `node --test tests/domain.test.mjs` against baseline and record failing assertions.
- [ ] Implement per-cleaner slot feasibility, object limits, safe role projections; replace read/check/write paths with locked SQL commands and atomic event records.
- [ ] Test actual database: concurrent claims yield one winner, duplicate completion one event, stale cleaner denied, overlapping assignments rejected, rollback leaves no partial events.
- [ ] Review diff and commit tested implementation.

## Task 2: Stable mobile and operations UI
Files: assets/app.js, assets/operations-ui-core.js, assets/live-updates.mjs, assets/styles.css, assets/supabase-client-entry.mjs, sw.js; tests/browser.spec.mjs.
Interfaces: Existing API routes remain. Command request ID travels in body. New live controller batches events and defers while editing; retries reads and explicit uncertain writes retain same key.
- [ ] Browser regression: focus input, type text, deliver live event, assert value/focus persist. Navigate during pending request and assert new route remains.
- [ ] Preserve shell, implement versioned rendering, live status/recovery, safe cache allowlist; add password reset flow, all-day availability and upload progress.
- [ ] Validate five-role navigation, assignment, checklist/proof, client slots, finance month and logout cache clearing in browser.
- [ ] Review and commit.

## Task 3: Product operations extension
Files: supabase/functions/st-api/operations.mjs; additional SQL migration; assets/operations-extension.js; tests/operations.test.mjs.
Interfaces: authenticated routes for recurring templates, categories, bulk planning and notification status. Existing object/job IDs retained.
- [ ] Tests assert repeat expansion unique per template/date, date windows valid, portfolio isolation and bulk all-results reporting.
- [ ] Add categories, recurring schedule generation with unique database key, controlled bulk scheduling, exception reasons, editable per-object checklists.
- [ ] Integrate admin/client screens; verify actual roundtrip and denied cross-portfolio writes.
- [ ] Review and commit.

## Task 4: Exact financial records and complete reports
Files: supabase/functions/st-api/finance.mjs; migration; assets/finance-extension.js; tests/finance.test.mjs.
Interfaces: exact minor-unit amounts; st settlements append-only with unique request keys. Keep existing summaries compatible, separate accrued/paid/outstanding.
- [ ] Tests assert 0.1+0.2 financial result exactly 30 cents, duplicate payment not counted twice, overpayment invalid, corrections explicit.
- [ ] Add invoice/payment and cleaner settlement records, SQL aggregates for completed jobs and manual entries; cursor page history and bounded exports.
- [ ] UI shows earned versus paid and debts; all five roles tested for access.
- [ ] Review and commit.

## Task 5: Media, release and integration
Files: server media routes, asset upload module, scripts/build.mjs, scripts/package.mjs, tests, README.md, release report.
- [ ] Tests enforce allowed media, object ownership, max size and unique finalize; storage failures never mark completion.
- [ ] Implement authenticated direct upload preparation/finalize, retry/progress and protected delivery, retaining legacy photo contract.
- [ ] Build pinned dependencies and PHP shell; ensure application version contract matches server while allowing controlled upgrade.
- [ ] Run all unit/SQL/browser suites, concurrency workload and 100000 synthetic-history aggregate check; record metrics and limits.
- [ ] Independent final review, fix confirmed findings, package code/tests/migrations/rollback notes and persist release.
- [ ] Deploy only validated compatible server changes, verify read-only health; Hostinger update requires available deployment capability or delivered archive.

## Interface preflight
| Tasks | Shared interface | Ruling |
|---|---|---|
| 1 / 2 | existing routes and request ID | Preserve routes; clients add body.requestId; server supports legacy callers safely |
| 1 / 3 | job command and recurring creation | Existing IDs retained; creation uniqueness enforced in DB |
| 1 / 4 | completion and accrual | Completion exactly once, financial record keyed by job |
| 2 / 5 | upload UX and auth | One upload adapter; private file data never cached by shell |
| 1–5 | index.ts and app.js | Sequential integration; one implementer owns each active task |
| Each task | tests versus implementation | Tests use actual domain/database behavior, not source string matches |
