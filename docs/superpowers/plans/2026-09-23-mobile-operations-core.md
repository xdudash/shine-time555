# Mobile Operations Core Implementation Plan

**Goal:** Make dispatcher navigation and job handling usable at phone widths while preserving the existing server-backed work cycle.

**Architecture:** Reuse the role-filtered admin shell and API data. Add a responsive drawer to that shell and a card projection of the same job list for Live/Jobs. CSS hides only the alternate presentation; routes and commands remain shared.

**Tech Stack:** Vanilla JS, CSS, PHP shell, synthetic GitHub Pages preview, Node tests.

**Spec:** `docs/ssd/specs/012-mobile-operations-core.md`

## Steps

- [x] Identify the missing mobile route control and wide-table bottleneck in the actual shell and styles.
- [x] Add a role-filtered mobile drawer with visible trigger, accessible state and close behavior.
- [x] Render mobile job cards from the same authorized response as desktop tables; synchronize search.
- [x] Include the mobile CSS in PHP and preview build.
- [x] Run full tests, build, PHP lint and preview safety checks; resolve failures. Also run browser journeys at 320/390px and desktop.
- [ ] Publish via PR and verified-main workflow; inspect the deployed release.

## Review focus

- Manager's hidden routes must not appear in the drawer.
- Opening and closing the drawer must not invalidate the current page.
- Empty job lists and filtered lists must remain understandable.
- Long addresses and 320px screens must not cause horizontal page overflow.
- Desktop table/export and mobile cards must derive from the same response.
