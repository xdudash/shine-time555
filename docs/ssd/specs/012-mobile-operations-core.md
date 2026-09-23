# SSD-012: Mobile operations core

**Status:** Accepted for implementation under the user's 2026-09-23 mobile/core request  
**Last reviewed:** 2026-09-23  
**Deployment:** Pending verification

## Problem and outcome

At widths up to 820px, the admin sidebar disappears without a replacement. Admins and operations managers cannot reach most operational screens from a phone. Live and Jobs present eight-column tables that require horizontal scrolling before a job can be opened. A mobile dispatcher must be able to move between permitted screens and open a job in a few taps.

## Scope and behavior

- Keep the existing role-filtered admin navigation and direct-route guard. Add a 44px menu trigger, full-height drawer, backdrop, close control, Escape handling, focus on the active navigation item, and close on navigation.
- On narrow screens, show actionable cards for Live and Jobs with risk, status, cleaner, plan/ETA, amount, and Open job. Keep the desktop tables, search and server-backed actions.
- Preserve the API contract, localization selector, cleaner and owner flows, data ownership and existing job transition rules.
- CSS lives in a dedicated mobile layer shared by Hostinger and synthetic GitHub Pages preview. Desktop behavior stays unchanged.

## Data and authorization

No schema, API, permission, authentication, or customer-data changes. The card reads the same authorized admin/manager response as the table. The manager's permitted navigation is still filtered by `adminNavigationForRole`; server authorization remains authoritative.

## Acceptance

| Given | When | Then |
| --- | --- | --- |
| 320–820px admin viewport | Open menu | Permitted route list is visible and usable; trigger expanded state updates |
| Operations manager | Open menu | Restricted admin routes remain absent |
| Mobile dispatcher | Open Live or Jobs | Job card shows state and Open job action |
| Jobs search/filter | Enter query or apply server filter | Visible cards and table data follow the selection |
| Navigation or Escape | Drawer is open | Drawer closes without losing the route |
| Desktop | Open Live or Jobs | Existing table and sidebar remain available |

## Release

Run tests, build, PHP lint, preview build/safety, then release the frontend through verified-main Pages workflow. Roll back the frontend commit if navigation regresses. The real Hostinger/Edge production parity gate remains separate.

## Verification evidence

Local: `npm ci`, 118/118 Node tests, `npm run build`, PHP WASM lint, preview build/safety and 54-file frontend package succeeded. Browser test checked 320/390px viewport width, mobile drawer, manager route filtering, card search, cleaner lifecycle and desktop navigation; no page errors. Published release verification follows CI.
