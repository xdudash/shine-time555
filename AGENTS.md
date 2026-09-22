# Agent instructions — Shine Time

Read this file, `README.md`, `docs/architecture.md`, and the relevant specification before changing the repository. These rules apply to human and automated contributors.

## Mission and source of truth

Build an operations platform for cleaning jobs and properties. User roles are admin, manager, property owner, and cleaner. The current repository is a deployable snapshot, **not** the original React source project. It contains a compiled bundle and a PHP entry point. Never pretend a source tree, migration, API implementation, or automated test exists when it does not.

Priority: current explicit user request > accepted feature spec > `docs/product.md` > `docs/architecture.md` > this file > assumptions. Record contradictions in the pull request.

## Before work

1. Read `docs/ssd/README.md`. Choose the smallest change with one outcome.
2. Confirm the files and integration points actually exist. Read existing behavior before editing.
3. For feature, permission, data model, or API changes, create/update an accepted spec under `docs/ssd/specs/` using the template. For trivial copy and doc changes, explain scope in the pull request.
4. Do not edit the generated `assets/platform.js` to implement product features. First recover the source project and reproducible build, or get an explicit exception with a tested rollback plan.
5. Check `docs/roadmap.md` for sequencing and dependencies. A roadmap entry is a proposal, not proof that a feature works.

## Implementation rules

- Keep one issue / branch / pull request focused on one behavior. Do not mix formatting with behavior changes.
- Define role permissions on the server and in Supabase RLS. Hiding UI controls is never authorization.
- Never place service-role keys, private tokens, entry codes, customer details, or raw cleaning photos in commits, logs, issues, screenshots, or prompts.
- Gate property access instructions and photos by accepted job and the correct property/assignee; verify access server-side and in storage policies. Define how access is revoked after reassignment or completion.
- Changes to Supabase schema, policies, Edge Functions, storage, or Auth require a versioned migration/source artifact and a separate review of authorization. Do not apply a live database change merely because a file was committed.
- For future source reconstruction, isolate domain modules and typed API contracts; keep generated output separate from editable source and record exact build commands and pinned dependencies.
- Preserve SK/UA/EN localization when touching user-facing strings and verify phone-width behavior for cleaner flows.

## Verification and delivery

Run the checks relevant to the change and report what actually ran. At minimum, run `node --check assets/platform.js` and `php -l index.php` / `php -l config/supabase.php` when tools are available. CI runs these checks. No test result proves database permissions without a role-based integration test.

For permission changes, test admin, manager, owner, assigned cleaner, unassigned cleaner, and signed-out users. For assignment changes, verify accept, reject, reassignment, concurrent accepts, and offline/retry behavior.

The pull request must include: intent, spec link, touched areas, evidence, data/security impact, deploy and rollback notes, and limitations. Update the spec status, architecture, and changelog when behavior actually changes. Do not mark a roadmap item complete based only on documentation.
