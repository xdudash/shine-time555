# SSD-013: Reviewed cleaning delivery and mobile recovery

Status: Accepted by the user's 2026-09-28 instruction to implement the supplied platform concept.

## Outcome
Managers operate many parallel jobs from a phone, inspect submitted proof and either accept delivery or request rework. Cleaners retain account-scoped checklist edits across a lost connection. Owners see whether delivery is awaiting review, accepted or needs rework. The existing Hostinger PWA and Supabase remain authoritative.

## Behavior
- A day board groups authorized jobs into unassigned, assigned, active, at-risk, review, completed and cancelled. Query, area, cleaner and date filters survive refresh. Counts describe the filtered day, not the entire database.
- Operational completion submits a job for review. Separate review_status/review_version preserve the existing operational state machine. Historical completed jobs become approved. New pending work cannot settle before approval.
- ADMIN and OPERATIONS_MANAGER can review with expectedVersion and requestId. Rework requires a note and retains evidence/history; settled work cannot reopen. Repeat commands have one effect.
- Assigned cleaners see review instructions; clients receive status but no internal review note. UI shows submitted versus approved distinctly.
- Checklist drafts contain only account/job/item IDs and booleans, expire after 24 hours, and clear on logout. Fresh server authorization precedes synchronization. Revoked/terminal work discards drafts visibly. Network failures retain drafts. No acceptance, completion or money command is queued offline.
- All new copy is available in SK/UK/EN/RU. Mobile layouts target 320–430px and desktop.

## Delivery boundaries
Changes are prepared against repository source. Production drift is documented in existing recovery inventory; no production migration or deployment is authorized implicitly by a commit. Preview is synthetic and read-only. New roles/organizations, team slots, subscriptions, payment processors, cross-country currencies, persistent media upload queue and instruction versioning remain separate roadmap work, not claimed by this slice.

## Acceptance
1. Fifty competing existing claim commands still have one winner in native PostgreSQL CI.
2. Pending review cannot settle; approval can; stale/concurrent opposite review decisions conflict.
3. Owner/cleaner cannot call manager review RPC; internal review notes are not projected to clients.
4. Offline checklist edits survive new module instances; unrelated accounts cannot see them; interleaved edits survive earlier acknowledgements.
5. Mobile day board filters intersect and review controls submit the current version, never optimistic approval.
6. Approved/rework/pending labels render in cleaner, client and manager views.
7. Full Node tests/build, preview safety and browser flows pass. Report unavailable native/staging checks explicitly.

## Rollout
Apply additive migration in staging, deploy matching API, then frontend. Rehearse backup and forward-fix before production. Old completion clients remain server-gated. Frontend rollback alone does not remove review gates; retained backend requires an operator review path.
