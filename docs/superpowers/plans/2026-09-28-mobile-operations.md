# Mobile operations implementation plan

> For agentic workers: execute the approved implementation using executing-plans; independent pure modules and backend work are delegated under dispatching-parallel-agents.

Goal: close the operational gap between executing, checking and settling a cleaning while retaining mobile work through connection loss.
Architecture: existing PWA consumes authenticated st-api; PostgreSQL owns review transitions; independent pure browser modules own filtering and non-sensitive checklist drafts.
Tech stack: JavaScript/esbuild, PHP shell, Supabase/PostgreSQL, Node tests, PGlite, browser verification.
Spec: docs/ssd/specs/013-quality-dispatch-recovery.md

## Global constraints
Preserve SK/UK/EN/RU, existing history, role/data isolation, exact money and production deployment gates. No secrets in drafts or preview. Generated bundles built, never hand edited.

## Review focus
- Opposite manager decisions arriving concurrently must not overwrite each other.
- Old clients cannot settle a newly pending job.
- Logout during synchronization cannot restore cleared drafts.
- Rework completion cannot double lifetime counters or payouts.
- Background refresh must retain date/filter selection and active input.

## Tasks
- [x] 1. Backend review: additive migration, st_review_job(actor,job,decision,note,expectedVersion,requestId), st-api admin review route, safe projections and settlement gate. tests/quality-review.test.mjs: pending -> approve/rework, replay, denied roles, stale version, preserved proof and counters. Run node --test tests/quality-review.test.mjs and existing DB suites.
- [x] 2. Draft module: assets/checklist-drafts.mjs createChecklistDrafts with set/list/clear/flush; tests/checklist-drafts.test.mjs for persistence, scope, expiration, stale access, network failures and interleaving edits. Run focused tests before integration.
- [x] 3. Board module: assets/operations-board.mjs deriveBoard and bucketForJob; tests/operations-board.test.mjs for intersecting filters, primary buckets, Unicode and immutability. Run focused tests.
- [x] 4. Integrate assets/app.js, new assets/operations-workspace.css and translations; add bundles to build/index/preview. Browser verifies 320/390px board, review buttons/version, cleaner pending/rework, draft retry and client labels.
- [ ] 5. Full tests/build/preview safety/package, isolated browser flows, final independent review, fixes, publish branch and PR. Do not claim production verified.

## Baseline and rulings
- Fresh isolated clone on feat/mobile-operations-complete; npm ci succeeded.
- Baseline npm test: 117 passed, 1 failed, live.test.mjs fixed-timer race under parallel load. Replace fixed sleep with event-based assertions, then rerun.
- User's execution instruction accepts the concept; execute without repeated routine permission prompts.
- First release focuses on a complete reviewed-delivery slice; broader approved product requirements stay in master roadmap until implemented with evidence.

## Execution ledger
- Tasks 1–4 implemented with dedicated database/domain tests and integrated browser checks.
- Review: two Important findings reproduced RED then fixed GREEN in tests/workspace-browser.mjs (in-flight opposite edit and filtered summaries).
- Ruling: no production changes; source/production drift requires a separately verified release. Cost: new functions are unavailable to real users until staging and controlled deployment.
- Ruling: local draft storage contains checklist intent only. Cost: a disconnected reload cannot reopen private instructions until an authorized network fetch succeeds.
- Ruling: no automatic payout processing; financial entries record actual externally performed payments. Cost: payments still require the existing manual process.
- Financial aggregates retain earned accrual while exposing waitingReviewCents and approved-only payableCents.
- Full native PostgreSQL contention runs in GitHub CI, not PGlite.
