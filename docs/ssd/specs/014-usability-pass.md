# SSD-014 — Usability pass across all roles (frontend only)

**Date:** 2026-10-01 · **Scope:** browser application; no schema or API change · **API contract:** `2026-09-28-quality1` (st-api v13)

## Problem (found by walking every role on desktop and 390 px)

- Server features without UI: property-manager portfolio, admin job cancel, job window/duration edit, monthly batch settlement.
- Object coordinates had to be typed as numbers; cleaners had no route link to the property.
- Clients could not see how far a cleaning had progressed.
- ~90 (RU) to ~160 (UK) interface strings stayed English, incl. counters ("3 jobs", "90 min"), enum codes and the audit trail (`STATUS_EN_ROUTE`); switching language did not translate the navigation.
- Native `prompt()`/`confirm()` for cancellations and password resets (blocked or clumsy in installed PWAs).
- Unreadable chips on the cleaner "Next cleaning" card; admin sidebar footer (Sign out) overflowed its background on short screens; "hard deadline 15:00" hard-coded although windows are per property.

## Behaviour

| Role | Change |
| --- | --- |
| Admin | Client modal of a property manager lists all properties with checkboxes and search; ticking links/unlinks through `admin/clients/{id}/properties`. |
| Admin, Ops manager | Job modal: edit earliest start, deadline, duration and marketplace visibility (existing `PATCH admin/jobs/{id}`; finance fields untouched so operations managers may use it); **Cancel job** with a required reason (`POST admin/jobs/{id}/cancel`); readable history; Google Maps/Waze links; tap-to-call cleaner. |
| Admin | Payments & payouts → **Monthly settlement**: per client or cleaner, approved jobs only, selectable, one idempotent `POST admin/settlements/batch`; jobs awaiting review are counted separately. |
| Cleaner | Google Maps / Waze buttons on the active job; release dialog with reason; readable status toasts; window instead of fixed deadline; My Day shows the real latest deadline. |
| Owner / manager | Booking detail shows a step tracker (booked → assigned → on the way → arrived → cleaning → quality check/approved) and readable payment status. |
| All | In-app dialogs; composite-string translation (counters, times, "A · B", "a + b"); 225 new RU/UK/SK labels; language switch re-renders navigation; euro shown as `€` in every locale. |
| Owner, Admin | Object forms: "Find coordinates from address" (OpenStreetMap Nominatim, only the typed address is sent) and "Use my current location". |

## Security and privacy

No authorization moved to the browser: every action uses an existing endpoint that re-checks role and scope. Address search sends only the address text the user typed to `nominatim.openstreetmap.org`; no identifiers or tokens.

## Verification

`tests/usability-browser.mjs` (added to `npm run test:browser`): request payloads and resulting UI for schedule edit, cancel dialog (reason required), readable history, maps and phone links, portfolio link/unlink/search, geocoding, cleaner release dialog in Russian, client tracker, monthly batch (selection total, approved-only notice, request id), navigation translation. Existing browser, preview and production bundle tests pass unchanged except `interface-reliability` now injects `askConfirm` instead of `confirm`.

## Open

Cleaner phone is visible to owners in job projections (pre-existing API behaviour); decide whether clients should see it. Service date change for an existing job needs an API command (not in this slice).
