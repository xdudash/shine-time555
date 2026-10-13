# SSD-019 — Stage 2, second block: nine sections, the owner archive, editable records

**Date:** 2026-10-12 · **Scope:** Edge Function + browser + one migration · **API contract:** `2026-10-12-stage2` (unchanged by this block; the routes it adds are additive)
**Approval:** the audit list of 2026-10-12, fixes **21**, **22**, **23** and **25**. With these, stage 2 is complete.

## Fix 21 — the nine approved sections

The menu had grown to sixteen entries with three separate finance pages and four different views of the same day. The approval document's own table is now the menu:

| Section | What is inside | What it absorbed |
| --- | --- | --- |
| Today | day dispatch, map, tomorrow, monitoring | Live Operations, Map, Tomorrow, Monitoring |
| Cleanings | all cleanings, repeating | Jobs, Recurring jobs |
| Review | reports awaiting a decision, issues and client complaints | Issues |
| Objects | properties, prices, standards, photos, approval | Objects |
| Clients | owners and property managers, property links | Clients |
| Team | cleaners and operations managers | Cleaners |
| Finance | Overview · Statements · Payments and payouts · Records | Owner board, Finance, Payments & payouts, Statements |
| Analytics | the measured metrics of fix 12 | Analytics |
| Settings | the audited settings of fix 13 | Settings |

How it is built, so that nothing was rewritten to achieve it:

- `renderAdmin(section, tab)` resolves a section and its sub-tab, then delegates to **`renderAdminPage(page)`** — the former `renderAdmin`, unchanged. The three extensions (`operations-extension`, `finance-statements`, `monitoring-extension`) now wrap that page dispatcher and no longer splice menu entries of their own.
- `ShineTimeUi.adminSectionFor` maps every old page name to the section that hosts it, and `navigationRoute` highlights the section. **Old links keep working**: `#admin/jobs`, `#admin/statements`, `#admin/live` all still open their screen, with the right menu entry lit.
- The operations-manager boundary is unchanged and now checked on both the page and its section, so a manager cannot reach a finance tab by typing its old route.
- One new screen: **Review → Awaiting review**, the approval queue as a page of its own instead of a bucket on the day board. It needed a server change: `admin/jobs?review=PENDING` drops the single-day filter, because a report submitted on Friday is still waiting on Monday.

## Fix 23 — the owner's archive

`client/bookings` takes `from`, `to`, `objectId` and `status` (`ALL`, `OPEN`, `COMPLETED`, `CANCELLED`, `EXPIRED`), returns the filtered page plus the properties to choose from, and computes the totals **over the whole filtered set**, not over the page shown. The client screen became filters plus a table — which is what the existing CSV export picks up — with the charged total in the header and counts of completed, cancelled and expired beneath the filters. A property that is not the caller's is a 404, not an empty list.

## Fix 25 — records that can be corrected, with their history

A wrong finance entry could only be deleted and retyped, and the delete left no trace. `AGENTS.md` requires finance history to be preserved, so:

- `st_finance_entry_audit` keeps a row per change: `CREATE`, `UPDATE` or `DELETE`, with `before_json`, `after_json`, the reason and who did it. It deliberately has **no foreign key** to the entry, so the audit of a deleted entry stays readable.
- `st_save_finance_entry` creates or corrects an entry; `st_delete_finance_entry` keeps the whole row in the audit before removing it; `st_finance_entry_history` reads the trail. All three are administrator-only — an operations manager never sees money.
- The UI edits an entry in place, asks why, and shows the history next to the form. A delete asks for a reason and says plainly that the deletion is kept.
- **Recorded settlements are untouched.** Payments to clients and cleaners stay append-only; a mistake there is corrected by its counter-entry (`CLIENT_REFUND` / `CLEANER_RETURN`), as the settlement command already does. A scenario asserts no function rewrites `st_settlements`.
- Photo captions: `st_update_photo_caption` + `PATCH objects/{id}/reference-photos/{photoId}` correct a caption in place, so the file never moves and the photo keeps its identity. The people who may add or delete a photo may rename it — operations and the property's owner; a property manager may look, not edit.

## Fix 22 — the inherited screens in all four locales

The recurring-schedule, payments-and-payouts and generation screens still had twenty hard-coded English labels (`Weekdays`, `Record payment`, `Reference / reason`, …). They now go through `t()` and are translated into ru/uk/sk along with the ~60 new labels of this block. The crawl over every screen of every role reports only `Email`, `IČ DPH` and `🧭 Google Maps`, which stay as they are by design.

## Verification

`docs/verification/2026-10-12-stage2-admin-tidy.md`.

## Open

Stage 2 is complete with this block. Stage 3 remains: client self-registration with owner approval, retiring `site-session` and the legacy tables, removing the superseded photo-upload path, and the move to `shinetime.sk/app`.
