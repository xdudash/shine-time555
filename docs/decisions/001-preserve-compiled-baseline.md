# ADR-001: Import real source and preserve recovered deployment

**Status:** Accepted for repository organization, 2026-09-22.

## Context

The new repository first contained only a compiled deployment snapshot. We subsequently located the fuller source repository `xdudash/shine-time` at commit `3dc3ecd21661f86ac0d4c834b860617bc9d34a9b`, with tests, Supabase migrations, `st-api`, and a build pipeline.

## Decision

Import the tracked source as the basis for `shine-time555`. Preserve the compiled archive under the repository history for comparison. Do not claim the imported build matches the later archive or current production until a parity review is complete. Exclude automatic production and Pages deployment workflows during migration.

## Alternatives and consequences

Editing the minified snapshot would block reliable maintenance. Leaving source in a separate repository would split the requested working base. Importing source creates a usable development baseline but may represent a different release; phase 1 of the master plan tests this gap before any deploy.
