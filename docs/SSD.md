# Shine Time — Software System Design (SSD)

**Version:** 1.0
**Baseline:** `2026-09-07-scale1`
**Status:** Reverse-engineered architecture + target evolution plan

> This document describes the architecture actually present in the repository and the direction in which the system should evolve. It is not a production acceptance certificate.

## 1. Purpose

Shine Time is an operations platform for cleaning services. The system manages the lifecycle of a cleaning job from booking through dispatch, execution, evidence, issues, notifications and financial records.

Primary roles:

- `ADMIN` — full system control
- `OPERATIONS_MANAGER` — operational management
- `CLEANER` — job execution
- `OWNER` — own properties/bookings
- `PROPERTY_MANAGER` — assigned properties/bookings

## 2. System Context

```text
Browser / Mobile PWA
        |
        | HTTPS + JWT
        v
Hostinger frontend shell
        |
        | authenticated API calls
        v
Supabase Edge Function: st-api
        |
        +-------------------+--------------------+
        |                   |                    |
        v                   v                    v
Supabase Auth         PostgreSQL             Storage
identity              transactional truth   private evidence
                            |
                            +--> Realtime signals
                            |
                            +--> Cron / recurring worker
```

### Architectural principle

The browser is untrusted. Domain state is authoritative in PostgreSQL and sensitive mutations go through `st-api` and transactional database operations.

## 3. Runtime Components

### 3.1 Frontend

Hostinger serves the HTML/PWA shell and static JavaScript. `index.php` injects runtime configuration and build metadata. The application logic lives in the frontend JS modules.

The frontend must not be treated as a security boundary.

### 3.2 API — `st-api`

The Edge Function is the application/API boundary. Responsibilities:

1. Parse request.
2. Authenticate JWT with Supabase Auth.
3. Resolve `st_users` application identity.
4. Authorize role.
5. Authorize resource ownership/assignment.
6. Validate request data.
7. Execute domain command/query.
8. Return a safe projection.

### 3.3 PostgreSQL

PostgreSQL is the transactional source of truth. Core tables are under the `st_*` namespace.

### 3.4 Storage

Cleaning evidence is stored in private Supabase Storage. Access is mediated through upload tickets and signed URLs.

### 3.5 Realtime

Realtime is a notification/invalidation mechanism, not the authoritative source of state. Clients refresh authoritative state after receiving a signal.

### 3.6 Recurring worker

Cron generates a rolling future horizon of recurring jobs. Generation must be idempotent for object + service date.

## 4. Domain Model

```text
st_users
  |
  +--> st_cleaners
  |
  +--> st_client_accounts
          |
          +--> st_objects
                 |
                 +--> st_jobs
                        |
                        +--> st_job_checklist
                        +--> st_job_photos
                        +--> st_issues
                        +--> st_job_events

st_cleaner_availability ---> scheduling
st_notifications ---------> communication
st_financial_entries -----> finance
st_settings --------------> policies/configuration
st_recurring --------------> recurring generation
```

### Central aggregate: Job

`st_jobs` currently combines booking, assignment, execution, scheduling, risk/rescue and job-level financial values. This is acceptable as the current persistence model, but the domain model should be separated conceptually into Booking, Assignment, Execution, Risk and Finance components as the product grows.

## 5. Job State Machine

```text
UNASSIGNED --> OFFERED --> ACCEPTED --> EN_ROUTE --> ARRIVED --> CLEANING --> COMPLETED
      |            |           |
      +------------+-----------+--> AT_RISK --> RESCUE

Any valid operational state ------------------------------> CANCELLED
```

State transitions must be explicit. A generic admin PATCH must not become an escape hatch around domain rules.

### State transition rule

Every transition must validate:

- current state;
- actor role;
- actor/resource relationship;
- required prerequisites;
- temporal constraints;
- idempotency key where command retries are possible.

## 6. Scheduling / Dispatch

Scheduling combines:

- cleaner availability;
- maximum jobs/day;
- existing assignments;
- service window;
- job duration;
- travel buffer;
- same-zone buffer;
- safety buffer;
- deadline feasibility;
- cleaner eligibility.

Target flow:

```text
Candidate jobs
    |
    v
Eligibility policy
    |
    v
Schedule projection
    |
    v
Conflict/deadline validation
    |
    v
Atomic commit
    |
    v
Authoritative job schedule
```

Do not calculate a schedule and then update jobs independently if another actor can modify the same schedule concurrently. The final commit must be transactional.

## 7. Risk / Rescue

Risk is derived from operational pressure such as unassigned status, deadline pressure and rescue conditions.

Target architecture:

```text
Operational facts
      |
      v
Risk policy engine
      |
      +--> score
      +--> level
      +--> reasons
      +--> recommended action
```

Risk calculation should be deterministic and configurable. Thresholds must not be duplicated across frontend, API and database code.

## 8. Authentication and Authorization

Identity chain:

```text
auth.users
   |
   | auth_user_id
   v
st_users
   |
   +--> role / permissions
   +--> cleaner profile
   +--> client account
```

Authorization has two layers:

1. RBAC — what the role may do.
2. Resource authorization — which specific jobs/objects/users the actor may access.

Never trust role, IDs or ownership claims supplied by the browser.

## 9. Media / Evidence

Target media flow:

```text
prepare upload
      |
      v
short-lived upload ticket
      |
      v
private Storage upload
      |
      v
finalize
      |
      v
validate actual object bytes
      |
      v
create st_job_photos record
```

Required hardening:

- private bucket;
- short-lived upload permission;
- size limit;
- magic-byte validation;
- image dimensions/pixel limits;
- decompression-bomb protection;
- safe object naming;
- no executable content;
- orphan cleanup;
- signed download URLs.

## 10. Finance

Current model contains job financial fields plus `st_financial_entries`.

Target direction:

```text
Job economics
     |
     v
Financial transaction
     |
     +--> immutable accounting entry
     +--> source type/id
     +--> amount/currency
     +--> actor
     +--> timestamp
     +--> audit reference
```

Financial records must be append-only where practical. Corrections should be compensating entries rather than destructive edits.

The platform records accounting/settlement information; it does not itself become a bank/card transfer processor unless that scope is explicitly introduced later.

## 11. Concurrency and Idempotency

Critical commands must be safe under retries and concurrent actors.

Examples:

- two cleaners claim one job → exactly one winner;
- repeated completion request → one logical completion;
- repeated recurring generation → no duplicate booking;
- repeated settlement request → no duplicate financial effect.

Use request IDs/idempotency keys and database-level transactional guards.

## 12. Time Model

Target rule:

- persist absolute timestamps as UTC/timestamptz;
- represent business service date explicitly;
- interpret local operational times using one configured business timezone;
- do not duplicate timezone defaults in multiple layers;
- test DST boundaries.

`Europe/Bratislava` is currently the configured business timezone. It should have one authoritative configuration source.

## 13. Realtime Contract

Realtime events should carry enough information to invalidate cached state but not become a second state store.

```text
DB transaction
     |
     v
signal/event
     |
     v
client receives signal
     |
     v
refresh authoritative query
```

## 14. Observability

Production observability should cover:

- request ID;
- authenticated actor ID;
- endpoint/action;
- duration;
- status/error class;
- database/RPC failures;
- upload failures;
- job transition failures;
- recurring worker failures;
- queue/scheduler lag where applicable;
- unexpected authorization denials.

Do not log passwords, access tokens, signed URLs or sensitive media metadata unnecessarily.

## 15. Deployment

```text
GitHub
  |
  v
CI
  +--> npm test
  +--> build
  +--> PostgreSQL concurrency tests
  +--> benchmark
  +--> frontend package
  |
  +----------------------+
  |                      |
  v                      v
Hostinger              Supabase
frontend               Edge Function + DB + Storage
```

Production release must be staged, backed up, tested with real Auth/Storage, and deployed atomically where practical.

## 16. Security Rules

1. Browser is untrusted.
2. No service-role secret in frontend or repository artifacts.
3. All sensitive commands authenticate the actor.
4. All sensitive commands authorize the resource.
5. Critical state transitions are transactional.
6. Database constraints enforce invariants where possible.
7. Media is private by default.
8. Signed URLs are short-lived.
9. Financial history is auditable.
10. Errors returned to clients are safe and do not expose internals.
11. CORS is explicit and minimal.
12. CSRF protections remain enabled wherever cookie-based browser sessions are used.

## 17. Architecture Debt

### P0 — release blockers to resolve before claiming production maturity

- Prove the actual production path and ensure there is only one authoritative backend path.
- Verify production Supabase RLS/security configuration, not only repository SQL.
- Verify every critical state mutation is covered by atomic command semantics.
- Verify real Auth + private Storage + all five role journeys in staging.

### P1 — next engineering wave

- Separate `st-api` into domain modules.
- Make scheduling a first-class domain service.
- Consolidate timezone/configuration ownership.
- Strengthen media validation and cleanup.
- Make finance a canonical append-oriented ledger.
- Add production observability and alerts.
- Formalize state-transition policies.

### P2 — scale / maintainability

- Introduce explicit domain DTOs/projections.
- Reduce coupling between job queries and mutation code.
- Add contract tests for API endpoints.
- Add property-based tests for scheduling and state transitions.
- Add performance budgets and database query monitoring.

## 18. Growth Roadmap — Step by Step

### Phase 0 — Freeze and baseline

**Goal:** know exactly what is deployed.

Steps:

1. Record production commit SHA.
2. Record deployed Edge Function version.
3. Back up application and database.
4. Export/verify Storage configuration.
5. Verify Auth configuration.
6. Verify RLS/policies against the actual production database.
7. Run all existing CI tests.
8. Create a staging environment with production-like configuration.
9. Document rollback procedure.

**Exit criteria:** production and repository versions are unambiguously identifiable.

### Phase 1 — Security hardening

1. Audit every `st-api` route.
2. Build a route × role × resource authorization matrix.
3. Test IDOR attempts for jobs, objects, users, media and finance.
4. Test invalid/expired JWTs.
5. Test replay of sensitive commands.
6. Test CORS and browser security headers.
7. Verify no privileged secrets reach frontend.
8. Test Storage path traversal and unauthorized signed URLs.
9. Add automated security regression tests.

**Exit criteria:** every sensitive route has explicit auth + authorization tests.

### Phase 2 — Domain state machine

1. Enumerate every valid job transition.
2. Enumerate forbidden transitions.
3. Move all critical transitions behind command handlers/RPC.
4. Remove generic mutation paths that bypass transition rules.
5. Add transition audit events.
6. Add concurrency tests for every claim/transition race.

**Exit criteria:** state invariants cannot be bypassed through normal API access.

### Phase 3 — Scheduling engine

1. Define scheduling inputs and invariants.
2. Centralize business timezone.
3. Separate projection from commit.
4. Implement deterministic conflict detection.
5. Add travel/same-zone/safety policies.
6. Add DST tests.
7. Add randomized/property tests.
8. Commit schedule changes transactionally.
9. Measure scheduling latency on realistic workloads.

**Exit criteria:** scheduling is deterministic, race-safe and independently testable.

### Phase 4 — Dispatch / Rescue

1. Define cleaner eligibility policy.
2. Define risk score inputs.
3. Define RED/ORANGE/GREEN thresholds.
4. Define rescue escalation states.
5. Define notification rules.
6. Add operator override rules with audit trail.
7. Add metrics: unassigned time, acceptance time, delay, rescue rate.

**Exit criteria:** dispatch decisions are explainable and measurable.

### Phase 5 — Media / evidence

1. Make bucket private.
2. Implement ticket expiry.
3. Enforce content sniffing.
4. Enforce pixel/dimension limits.
5. Re-encode untrusted images where appropriate.
6. Validate video container/size/duration policy.
7. Link evidence atomically to job records.
8. Sweep expired unreferenced uploads.
9. Add upload failure metrics.

**Exit criteria:** uploaded evidence cannot become an execution or storage security vector.

### Phase 6 — Finance

1. Define canonical money model.
2. Define currency policy.
3. Separate quoted price from earned revenue and payable cost.
4. Introduce append-oriented financial entries.
5. Define correction/reversal semantics.
6. Add idempotency to settlement.
7. Add reconciliation reports.
8. Add finance audit trail.

**Exit criteria:** every financial number has one canonical source and a traceable origin.

### Phase 7 — API and codebase decomposition

Refactor toward:

```text
st-api/
  index.ts
  router.ts
  auth.ts
  errors.ts
  security.ts
  jobs/
  cleaners/
  clients/
  objects/
  dispatch/
  finance/
  media/
  recurring/
  notifications/
```

Steps:

1. Extract pure helpers.
2. Extract route handlers.
3. Extract authorization policies.
4. Extract domain commands.
5. Extract queries/projections.
6. Keep behavior unchanged during each extraction.
7. Add tests before changing semantics.

**Exit criteria:** no single API file owns unrelated business domains.

### Phase 8 — Observability and SRE

1. Add structured logs.
2. Add request correlation IDs.
3. Add error monitoring.
4. Add API latency metrics.
5. Add database slow-query monitoring.
6. Add recurring-worker health checks.
7. Add alerts for auth failures, job-command failures and scheduler failures.
8. Define SLOs.
9. Define incident runbooks.

**Exit criteria:** production incidents are detectable and diagnosable without SSH archaeology.

### Phase 9 — Scale

Only after correctness is stable:

1. Load-test API.
2. Load-test job marketplace.
3. Load-test concurrent assignment.
4. Benchmark schedule projection.
5. Review indexes using real query plans.
6. Introduce caching only where measurement proves it useful.
7. Introduce queue/background processing for slow non-transactional work.
8. Define retention policies for events/media.

**Exit criteria:** scaling decisions are driven by measurements, not guesses.

## 19. API Design Standard

Every command endpoint should follow this conceptual contract:

```json
{
  "requestId": "client-generated-id",
  "payload": {}
}
```

Server response:

```json
{
  "ok": true,
  "data": {},
  "requestId": "client-generated-id"
}
```

Errors:

```json
{
  "ok": false,
  "error": {
    "code": "JOB_ALREADY_ASSIGNED",
    "message": "Job is no longer available"
  },
  "requestId": "client-generated-id"
}
```

Error codes should be stable machine-readable identifiers. Human messages may be localized client-side.

## 20. Testing Pyramid

```text
                 E2E / staging
                    /\
                   /  \
              API contract
                 /      \
          integration / DB
              /          \
        domain/property tests
           /              \
       unit tests          \
```

Mandatory regression suites:

- authentication;
- RBAC;
- resource authorization;
- job transitions;
- concurrent assignment;
- idempotent completion;
- scheduling conflicts;
- DST/timezone behavior;
- media authorization;
- finance idempotency;
- recurring generation idempotency.

## 21. Definition of Done for Production

A release is not production-ready until all are true:

- CI green;
- staging green;
- real Auth tested;
- private Storage tested;
- all five roles tested;
- authorization matrix tested;
- concurrency suite green;
- backup/restore procedure verified;
- rollback tested or rehearsed;
- monitoring active;
- no known P0 security issue;
- release SHA recorded;
- deployment artifacts checksummed;
- operator runbook updated.

## 22. Final Direction

The project should **not be rewritten from scratch**.

The preferred evolution is controlled hardening:

```text
Current platform
      |
      v
Security certainty
      |
      v
Atomic domain commands
      |
      v
Deterministic scheduling
      |
      v
Dispatch / rescue engine
      |
      v
Canonical finance
      |
      v
Observability
      |
      v
Measured scale
```

The architecture is viable. The next stage is to make its invariants explicit, eliminate bypass paths, centralize policies, and prove production behavior with repeatable tests.
