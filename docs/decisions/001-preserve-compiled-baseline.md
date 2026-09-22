# ADR-001: Preserve the compiled baseline

**Status:** Accepted for repository organization, 2026-09-22.

## Context

The recovered archive includes a compiled React bundle and PHP wrapper but no source project, package manifest, lockfile, backend source, or schema.

## Decision

Keep the existing bundle as a deployable reference. Add documentation and verification around it. Feature development waits for source recovery or an explicit, separately reviewed rewrite plan with parity tests.

## Alternatives

- Edit the minified bundle directly: hard to review, test, and reproduce.
- Rebuild from scratch immediately: risks losing undocumented working flows.

## Consequences and reversal

Short-term feature work is constrained. Reverse this decision when recovered or replacement source builds repeatably, key role flows match the baseline, and a rollback artifact is available.
