# Verification — stage 2, second block (sections, archive, editable records, locales)

**Date:** 2026-10-12 · **Branch:** `feat/stage2-admin-tidy` (on top of `feat/stage2-client-voice`) · **Spec:** `docs/ssd/specs/019-admin-sections-archive-records.md`
**Not deployed.** Needs the migration of this block plus the one from the first stage 2 block, and an `st-api` deploy; the build string stays `2026-10-12-stage2`.

## Environment limits

As before: no npm registry here, so `npm ci`/`npm run build` run in CI. `sw.js` is unchanged by this block (the build string did not move again), so no rebuild is owed. The database suites ran against local PostgreSQL 16 through the driver shim in `node_modules`; CI runs them on PGlite.

## 1. SQL

Full chain from scratch including `20261012190000_finance_entry_audit.sql`: `chain-ok`.

`tests/sql/stage2-admin-scenarios.sql`, exit 0, 10 sections:

| # | Scenario | Observed |
| --- | --- | --- |
| 1 | Who may write a finance entry | the operations manager and the owner are both refused with `Forbidden: finance requires administrator` |
| 2 | Bad input | `GIFT` as a type and an amount of 0 are refused |
| 3 | Creating | the entry is returned, and the audit holds one `CREATE` with no before and `after_amount 24.5` |
| 4 | Correcting | `before_amount 24.5 → after_amount 19.9` with the reason `Wrong amount on the invoice`, and **one** entry row still exists (no duplicate) |
| 5 | Reading the history | 2 rows for the administrator; the operations manager is refused |
| 6 | Deleting | `{deleted:1}`, 0 entry rows left, and the audit still holds the description and the amount of the deleted row plus the reason — `history_after_delete 3` |
| 7 | Deleting a missing entry | `Finance entry not found` |
| 8 | Settlements | `settlement_edit_functions 0` — nothing in the schema rewrites `st_settlements` |
| 9 | Photo captions | the administrator and the owner both rename it; the property manager and the cleaner are refused; a photo id that does not belong to the property is `Photo not found`; the stored caption is the last one written |
| 10 | Exposure | `authenticated` can neither read `st_finance_entry_audit` nor execute `st_save_finance_entry` |

## 2. Node suites

`node --test tests/*.test.mjs` → **197 tests, 197 pass, 0 fail**.

Three existing tests encoded the old menu and were updated with the change, not around it:

- `interface-reliability`: "direct extension routes enforce the same operations-manager boundary as navigation" now asserts the boundary at the new seam (`renderAdminPage`), that a manager is sent back to `admin/today`, and that `finance`, `statements` and `owner` are closed to a manager while `today` and `review` are open.
- `interface-reliability`: "finance mutation redraws pass through the shared render lifecycle" takes the whole handler blocks (both are multi-line now) and additionally asserts that a delete asks for a reason and that the dialog says the deletion is kept in the history.
- `navigation-tables`: the route table now covers all nineteen admin routes, old and new, each resolving to its section.

## 3. Browser suites

`tests/usability-browser.mjs` → **20 PASS lines**, three new:

- **admin menu: nine sections with sub-tabs, old links still land, manager boundary holds** — the sidebar has exactly the nine sections in the approved order; Today shows `Dispatch · Map · Tomorrow · Monitoring`; `#admin/jobs` still opens and lights up **Cleanings** (`aria-current="page"`); the Review section asks the server for `review=PENDING` and lists the waiting report; an operations manager's sidebar has neither Finance nor Clients but does have Today and Review.
- **finance entry corrected in place with a reason and a readable history** — the form opens on the entry being corrected (amount, description, category prefilled), asks why, shows `UPDATE … Wrong amount on the invoice` and `CREATE` in the history table, and saving sends **`PATCH`** to that entry's id with the new amount and the reason (not a second `POST`).
- **owner archive: filters drive the query, totals follow the filter, rows export as a table** — the header shows `2 cleanings · charged €42`; choosing `COMPLETED` re-queries the server and leaves one row with `1 cleanings`; a from-date re-queries again; Clear filters resets it; no horizontal scroll at 390 px.

The statements block was updated in the same spirit: Statements is now a Finance tab, so it asserts that the sidebar shows **Finance** highlighted and no longer offers a Statements entry.

All other browser suites and the production bundle pass unchanged.

## 4. Translations (fix 22)

A static sweep of the inherited screens found **20** hard-coded English labels in `operations-extension.js` (`Weekdays`, `Start time`, `Record payment`, `Reference / reason`, `Payment received from client`, `Existing jobs remain unchanged.`, …). They now go through `t()` and are translated into ru/uk/sk; the same sweep afterwards reports none left. With ~60 new labels for this block, the crawl over every screen of every role is back to the three intentional English strings (`Email`, `IČ DPH`, `🧭 Google Maps`), and the Slovak crawl is empty.

## 5. Not verified here

- The archive's CSV export uses the existing `exportVisibleTable`, which is covered by its own test; the file it writes was not opened in this run.
- Everything about this block is synthetic: the first production look is the owner's after deployment.
