# Interface reliability implementation plan

> Execute inline, task by task, using superpowers:executing-plans. The user already authorized implementation and publication.

**Goal:** Remove deceptive duplicate controls and fix navigation, error recovery and release freshness.
**Architecture:** Keep the core application and authenticated API; prune additive UI layers and share explicit render lifecycle events.
**Tech stack:** PHP shell, JavaScript, Node test runner, Supabase client, GitHub Pages preview.
**Spec:** docs/ssd/specs/011-interface-reliability.md

## Constraints and review focus

No production database writes or backend replacement. Preserve five roles, proof gates and exact-money handling. Test direct restricted navigation, asynchronous errors, nested reset URLs, repeated bootstrap and formula-like CSV values. Background updates must preserve edits.

### Task 1: Runtime and navigation

- [x] Add `tests/interface-reliability.test.mjs`, execute extracted real route functions in a VM with rejected API/render promises and all five roles; verify the entry point excludes 28 unused or duplicated extensions.
- [x] Run `node --test tests/interface-reliability.test.mjs`; expect failures on current routes and entry point.
- [x] In `assets/operations-ui-core.js`, expose `adminRouteAllowed(page, role)` using the same restricted route set as the navigation. Apply before extension route dispatch. Remove redundant inner async catches; central render handles foreground error with retry.
- [x] Remove 28 unused or duplicate script tags from `index.php`; emit `shine:rendered` after committed render. Disable preview worker registration and false live indicator. Replace bootstrap recovery subscription before adding another.
- [x] Re-run focused tests; commit after green full suite.

### Task 2: Export and asset freshness

- [x] Extend VM tests for selected month, visible rows, quoted strings and formula prefixes; test reset redirect under `/shine-time555/` and `/app/`.
- [x] Run focused tests and observe failures.
- [x] Change `assets/export.js` to consume `shine:rendered`, use `ShineTimeApp.getState()` and protect formula cells. Resolve reset redirect against `location.href`; content-hash every JS URL in PHP.
- [x] Run `npm test`, `npm run build`, `npm run check`, PHP syntax, `node scripts/build-preview.mjs`, `node scripts/check-preview.mjs`.

### Task 3: Review and publication

- [ ] Review full diff and test evidence; attach remaining production parity risks to recovery notes.
- [ ] Commit, open PR, verify CI, merge and confirm Pages build/version.
- [ ] Update the master plan and release evidence without claiming full production acceptance.

## Execution ledger

- Initial audit: production Edge v11 has modular source and property-photo/monthly-settlement additions absent from the imported repository. Frontend-only slice chosen to avoid overwriting deployed capabilities.

- Audit decision: retain a curated 13-script runtime. Additional localStorage payout, shift and draft layers have no callers in the core workflows and can imply persisted server state or restore another account's drafts. Remove their loading and the unused algorithm-only extensions; keep source/tests for future deliberate integration. Table enhancement now consumes `shine:rendered`, with no body-wide observer.

- Independent review found a wrong finance export month and finance redraws bypassing the new lifecycle. Both were reproduced as failing tests, then fixed. Cleaner-detail error propagation was also corrected with a failing test first.
- One legacy entrypoint test required the retired automation layer. Updated its intended contract to require the core live coordinator and forbid the duplicate layer; retained its archived helper tests.

- Verification: `npm ci`; `npm test` 116/116 pass, 47.9s; `npm run build`; `npm run check`; PHP WASM lint; preview build and safety scanner; frontend package; `git diff --check` all successful. Browser verification follows deployed release. Four legacy entrypoint contracts now enforce intentional retirement; archived helper tests remain.
