# SSD-NNN: Feature name

**Status:** Draft  
**Owner:** Product owner  
**Issue:** Link  
**Last reviewed:** YYYY-MM-DD  
**Deployed commit/date:** None

## Problem and user outcome

Who needs what, and why? Link to the observed behavior or user request. Separate confirmed facts from assumptions.

## Scope

- In scope: concrete behavior for this slice.
- Out of scope: explicit exclusions.
- Dependencies: source files, API, schema, policy, permissions, external systems; mark unknown as Unverified.

## Behavior and states

Describe trigger, inputs, success result, failures, retry, offline handling, and state transitions. Include UI copy for SK/UA/EN when relevant.

## Data and authorization

List entities and fields read/written, retention, access by admin/manager/owner/assigned cleaner/unassigned cleaner/signed-out user, server checks, RLS/storage policies, and audit events. Never embed actual access credentials.

## Acceptance scenarios

| Given | When | Then | Evidence |
| --- | --- | --- | --- |
| Role and initial state | User action | Observable outcome | Automated test or manual verification |

Include denied access, concurrency, stale session, and retry cases where applicable.

## Implementation slices

1. Paths and interfaces to change, in order.
2. Migration/build steps and compatibility boundary.
3. Tests and exact commands.
4. Rollout, observability, and rollback.

## Open decisions

List unresolved questions with owner and deadline. Resolve before `Accepted` when they affect security or data shape.

## Review and delivery evidence

PR links, CI run, role test results, release commit/date, observed outcome, and known limitations.
