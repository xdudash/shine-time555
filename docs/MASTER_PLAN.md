# Shine Time — master execution plan

**Version:** 1.0 · **Date:** 2026-09-22 · **Working repo:** `xdudash/shine-time555`

**Goal:** Turn the recovered operations platform into a dependable, maintainable system that can improve through small, reviewable changes. GitHub is the record for source, specifications, evidence, and releases. This plan is the queue, not a claim of implementation.

## How to execute this plan

- Work in the order below unless a production incident requires reprioritization. Each numbered checkbox is one issue or a small series of PRs; split a large item into reviewable vertical slices.
- Status is based on attached evidence. `[ ]` means incomplete even if old docs say “implemented.” Mark `[x]` only with a commit/PR, test output, and where relevant a deployed release.
- Before each feature: issue → `docs/ssd/specs/NNN-name.md` → accepted behavior → branch → code and tests → PR → CI → staging → controlled release → observation.
- Never infer current Hostinger or Supabase production state from the 2026-09-07 `docs/STATUS.md`. Verify it in the actual environment before release.
- A blocker is recorded with its owner and next proof needed. Work on the next independent item, but do not bypass a security or data gate.
- A GitHub commit never authorizes a production migration, credential change, or deployment by itself. Production is a separate controlled step.
- Target order: **P0** provenance and safety → **P1** reliable core workflow → **P2** product expansion → **P3** scale and operational maturity.

## Ground truth and discovered constraints

- Original source: `xdudash/shine-time` at `3dc3ecd21661f86ac0d4c834b860617bc9d34a9b` (2026-09-14); 149 tracked paths, source modules, `st-api`, migrations, tests, build.
- Earlier `shine-time555` was built from `Shine_Time_audit_update.zip` (2026-09-14 08:33), a five-file deployable snapshot. Preserve it as baseline commit `5862510c21ee2dd18d21d17ef37809b62bec1ade`; it is not a build recipe.
- `ShineTime-source.zip` is a separate public-facing marketing website; do not merge it into the operations app.
- The imported source's former production workflow is intentionally excluded. Existing Hostinger and Supabase systems have not been modified by this import.
- Product roles in source: `ADMIN`, `OPERATIONS_MANAGER`, `PROPERTY_MANAGER`, `OWNER`, `CLEANER`. The initial four-role summary was incomplete.
- Keep existing customer data and financial history; no reset or baseline migration replay against production.

## Phase 0 — provenance, CI, and safe working base (P0)

- [x] **P0.01 Find the source repository.** Evidence: upstream commit above and inventory in `docs/architecture.md`. The marketing-site ZIP was distinguished from operations source.
- [x] **P0.02 Import the exact upstream source into `shine-time555`.** Copy tracked source and preserve upstream commit provenance. Archive the five-file snapshot. Exclude production deployment workflows. Proof: manifest comparison, file hashes, target tree, no missing source paths.
- [x] **P0.03 Reconcile repository guidance with the imported source.** Update README, `AGENTS.md`, `docs/architecture.md`, historical SSD references, and decision log. Proof: no assertion that source or backend is absent, no broken doc links.
- [x] **P0.04 Establish a green baseline.** Run `npm ci`, `npm test`, `npm run build`, PHP syntax check, and `python scripts/package-frontend.py`. Capture versions, pass/fail, timing, and artifacts. Do not delete failing tests to get green.
- [ ] **P0.05 Audit and simplify CI.** Run relevant quality, integration, and verification workflows on PRs. Require syntax, build, tests, and artifact consistency. Prevent deployment from PRs and from the imported `main`.
- [ ] **P0.06 Compare imported source with archived release.** Diff routes, roles, API contracts, config, UI flows, and asset outputs. Classify features unique to each version. Produce `docs/recovery/parity-matrix.md` with impact and a chosen reconciliation path; no blind file overlay.
- [ ] **P0.07 Establish repository hygiene.** Check secrets, public configuration, dependency lockfile, generated artifacts, licenses, source map exposure, Apache path rules, and required GitHub permissions. Write findings without exposing sensitive values.
- [ ] **P0.08 Record environment inventory.** Document production and staging URLs, project refs, migration head, deployed Edge Function version, current Hostinger artifact hash, backup method, and responsible operator. If access is unavailable, mark each as unverified and request only the missing connection.

**Gate G0:** imported source and archived snapshot traceable; local and CI baseline recorded; no production deployment from repository.

## Phase 1 — contract and security inventory (P0)

- [ ] **P1.01 Build API catalog.** Enumerate all `st-api` routes/commands and clients in `assets/`; map request, response, auth, idempotency, and errors. Put verified contracts under `docs/contracts/`.
- [ ] **P1.02 Model state machines.** Document job booking, offer, claim, assignment, travel, arrival, cleaning, completion, cancellation, at-risk/rescue, and allowed actor transitions. Reconcile `docs/SSD.md` with SQL/API implementation.
- [ ] **P1.03 Create resource access matrix.** For each role and object/job/media/financial record list read/create/update/delete rules and ownership scope. Cover signed-out, unassigned cleaner, and reassigned cleaner explicitly.
- [ ] **P1.04 Audit migration chain.** Confirm ordered migrations apply to a fresh isolated database and upgrade a representative preexisting fixture. Check idempotency, backward compatibility, index impact, and rollback limitations.
- [ ] **P1.05 Audit RLS and Storage.** Verify exposed tables have RLS, correct policies and grants; views and privileged functions do not bypass intended authorization; media is private and signed links expire. Add denial tests for each role.
- [ ] **P1.06 Audit `st-api`.** Verify JWT validation, identity lookup, ownership checks, input validation, rate/size controls, safe projections, and error leakage. Add focused tests for any gap.
- [ ] **P1.07 Define test identities and fixtures.** Synthetic admin, operations manager, property manager, owner, assigned/unassigned cleaner, and anonymous actor. Never use production PII in fixtures.
- [ ] **P1.08 Baseline mobile journeys.** Measure login/recovery, property details, job acceptance, GPS/check-in, checklist, photo upload, issue, completion, manager dispatch, and owner visibility. Record environment and screenshots with synthetic data.

**Gate G1:** the same access rules appear in spec, API, RLS, storage, and tests; outstanding risks have owners and explicit severity.

## Phase 2 — core job reliability (P1)

- [ ] **P2.01 SSD-001: cleaner sees assigned work.** Reproduce the previously reported missing-job case. Fix query/projection/subscription or role policy as evidence dictates. Test each role and refresh after assignment.
- [ ] **P2.02 SSD-002: atomic claim and assignment.** Verify one winner under 50 concurrent claims and safe retries, reassignment, cancellation, stale offers, and clock boundaries. Repair only failing behavior.
- [ ] **P2.03 SSD-003: manager dispatch.** Separate recommendation preview from transactional commit. Test conflicting schedules, cleaner eligibility, time windows, and permission boundaries.
- [ ] **P2.04 SSD-004: job lifecycle.** Align API, SQL and UI state transitions. Test check-in prerequisites, offline retries, duplicate completion, event order, and audit attribution.
- [ ] **P2.05 SSD-005: navigation and GPS.** Reproduce failed map flow and inspect actual provider integration. Distinguish guidance from enforceable GPS proof; test denial, permission prompt, weak signal, and mobile coordinates.
- [ ] **P2.06 SSD-006: property guidance.** Add/verify photographs, entry instructions, access timing, revocation on reassignment/completion, private object URLs, and audit logging. Never expose door codes in list responses.
- [ ] **P2.07 SSD-007: issues and evidence.** Confirm file type/size, upload-ticket expiry, finalize idempotency, checklist completeness, and owner/manager visibility without cross-property leaks.
- [ ] **P2.08 SSD-008: recurring jobs.** Verify cron trigger, timezone/DST, duplicate prevention, isolated errors, cancellation, and observability.
- [ ] **P2.09 SSD-009: finance.** Preserve exact decimal aggregates, settlement history and corrections. Clarify record-only vs actual payment movement in UI and docs.
- [ ] **P2.10 SSD-010: operational notifications.** Realtime invalidation plus polling reconciliation, dedupe, offline reconnect, and role scoping.

**Gate G2:** a full synthetic job runs from booking to audited completion and settlement; unauthorized access is denied; concurrent actions stay consistent.

## Phase 3 — product quality and scale (P2)

- [ ] **P3.01 Localization:** audit all SK/UA/EN strings, date/number/currency formats, fallback, and push/error text. Add locale completeness checks.
- [ ] **P3.02 Mobile UX:** validate at 320–430px widths, keyboard/focus, upload progress, low bandwidth, and accessible status/errors for cleaners.
- [ ] **P3.03 Portfolio management:** owner vs property-manager memberships, multi-property filtering, search/pagination, deduplication, lifecycle and archived properties.
- [ ] **P3.04 Scheduling:** availability, duration, travel buffers, service window 10:00–15:00, resource conflicts, fair assignment, human override, and optimization metrics.
- [ ] **P3.05 Performance:** benchmark 50+ simultaneous users, bursty job claims, 100k historical rows, subscriptions, large media, and slow phones. Define p95 targets after baseline measurement.
- [ ] **P3.06 Data retention:** photo/video lifecycle, expired ticket cleanup, audit retention and GDPR request procedure; review legal retention with owner before deleting records.
- [ ] **P3.07 Observability:** structured logs without secrets, correlation IDs, error budget, dashboard, alert recipients, and incident runbook.
- [ ] **P3.08 Finance/exports:** define accountable reports and role-filtered CSV/export workflow; verify totals against database.

**Gate G3:** metrics measured in a production-like staging environment, user acceptance by each role, no open critical privacy/security issue.

## Phase 4 — delivery system (P0 before production switch)

- [ ] **P4.01 Staging parity:** separate Supabase project and deploy target, synthetic data, versioned config and access. No copied production secrets or customer media.
- [ ] **P4.02 Release artifact:** reproducible frontend package, source commit, migration list, function bundle/hash, checksum manifest, changelog and compatibility notes.
- [ ] **P4.03 Backups:** encrypted backup and restore rehearsal for application data; inventory Auth and Storage limitations separately.
- [ ] **P4.04 Controlled deploy:** manual approval, staging smoke, migration preflight, function deploy, frontend upload, post-deploy role journeys, monitoring and rollback trigger. Never enable imported auto-deploy without review.
- [ ] **P4.05 Rollback rehearsal:** previous frontend/function restoration, migration forward-fix strategy, preserved data, documented maximum recovery time.
- [ ] **P4.06 GitHub rules:** PR checks, protected main if permissions allow, CODEOWNERS and environment protections after responsible reviewers are identified.
- [ ] **P4.07 Release notes:** one entry per deployed slice with commit, environment, date, tested scenarios, known gaps and follow-up issue.

**Gate G4:** explicit release approval with current environment facts, tested backup/rollback, staging success, and human sign-off on customer-visible changes.

## Phase 5 — continuous improvement loop

- [ ] **P5.01 Triage weekly:** inspect incidents, cleaner feedback, manager workload, failed assignments, upload errors and slow screens; rank by impact.
- [ ] **P5.02 Deliver one slice at a time:** issue/spec/PR/test/release/observation cycle. Limit unfinished work; prefer reversible changes.
- [ ] **P5.03 Refresh SSD monthly:** keep `docs/SSD.md`, contracts, role matrix, migration map, and decisions consistent with released code.
- [ ] **P5.04 Measure value:** job acceptance time, unassigned rate, on-time completion, issue resolution, owner satisfaction, performance and error rates.
- [ ] **P5.05 Review dependencies and security:** pinned upgrades in separate PRs with regression evidence and rollback.
- [ ] **P5.06 Retire legacy:** remove obsolete paths only when usage telemetry and parity evidence prove safe removal.

## Immediate next actions after this plan is committed

1. Complete P0.02–P0.04 and attach baseline output to `docs/recovery/baseline.md`.
2. Perform P0.06: compare the archived five-file release with imported source before choosing which UI variant to serve.
3. Inventory current environment for P0.08 without applying database or deployment changes.
4. Select the first observed defect and write SSD-001 with a reproducible user journey.
