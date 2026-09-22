# SSD — specification-driven development

One feature moves through: **request → discovery → accepted spec → small implementation → evidence → review → release → observation**. The spec is an executable decision record, not a substitute for code or tests.

## Procedure

1. Open an issue describing user role, problem, expected outcome, and acceptance criteria. Record a baseline reproduction when fixing a bug.
2. For behavior changes, copy `template.md` into `specs/NNN-short-name.md`. Give it a unique number and status `Draft`. Identify existing contracts; mark unknown facts `Unverified`.
3. Review the spec with the product owner. Record decisions and change status to `Accepted`. A change touching multiple domains may have an umbrella spec and several independently deployable slices.
4. Create a short implementation plan in the spec: exact paths, ordering, migration impact, tests, rollout, rollback. Each pull request implements one slice and links the spec.
5. Verify acceptance scenarios including denied access, concurrency, failure/retry, and localization where relevant. Capture command output and environment, without personal data or secrets.
6. Merge after review and passing CI. Deploy separately; record deployed commit and observe metrics/error logs. Then mark the spec `Delivered`; archive superseded decisions instead of silently rewriting history.

## Statuses

`Draft` → `Accepted` → `In progress` → `Delivered`; `Superseded` with a link to the replacement. No status implies production deployment unless a deployed commit and date are recorded.

## Change sizing

Prefer one vertical slice with UI, server authorization, data change, and test when the behavior needs all four. Never ship a privacy-sensitive UI slice ahead of its enforcement. Documentation-only or build recovery changes can have smaller scopes with their own proof.

## Decision record

Record architectural decisions in `docs/decisions/NNN-short-name.md`: context, decision, alternatives, consequences, reversal trigger. Specs say what a feature does; decisions say why a shared technical choice was made.
