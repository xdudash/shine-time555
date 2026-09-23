# SSD-011: Reliable navigation and one operational interface

**Status:** Accepted for implementation under the user's audit request  
**Last reviewed:** 2026-09-23  
**Deployment:** Pending verification

## Problem and outcome

The imported entry point loads overlapping control panels. The command center's Notify action reports success without sending a request. Two extra consoles poll the DOM every 700/1500ms. Route failures leave a previous screen visible; operations managers can reach a client settlement endpoint through the admin extension. Password recovery resolves relative paths against the origin instead of the application directory.

## Scope and behavior

Retain the core dispatch board, job detail actions, recurring jobs, settlements, monitoring, notifications and GPS proof. Stop loading the 28 unused or overlapping extensions: operations-automation, operations-command-center, operations-dashboard, operations-command-surface, notifications-center, dispatch-console and job-lifecycle-console. Preserve their source for traceability; they are not supported runtime entry points.

Use the existing role-filtered navigation for both visible links and direct admin routes. Operations managers never request settlement data. Failed foreground loads replace stale content with an escaped error and Retry; background failure preserves the existing screen. Emit `shine:rendered` only after a page is committed. Export uses that lifecycle and the selected month, exports visible rows, and neutralizes spreadsheet formulas. Preview never registers a missing service worker and labels its status as demo.

Password recovery retains the deployed application directory. Repeated bootstrap replaces its prior auth listener. Version every PHP JS asset by content hash without changing the server compatibility build.

## Data and authorization

No database, API, policy, account or production data changes. UI restrictions complement existing server checks; they are not authorization. Existing role boundaries remain ADMIN, OPERATIONS_MANAGER, CLEANER, OWNER and PROPERTY_MANAGER.

## Acceptance scenarios

| Given | When | Then |
| --- | --- | --- |
| Operations manager | Opens admin/settlements directly | Redirects to live; no settlement request |
| Owner / cleaner | Opens permitted finance screen | Original role endpoint is used |
| Failed foreground request | Screen changes | Error and retry replace stale screen |
| Nested deployment | Password reset | Redirect retains the app directory |
| Preview | Bootstrap | No worker registration or false reconnect indicator |
| CSV with formula-like customer text | Export | Cell is text, not executable formula |

## Release and rollback

Run unit/database tests, build, PHP syntax and preview safety checks. Publish through verified-main Pages workflow. Revert the frontend commit to roll back. Production remains blocked by unreconciled Edge v11 source and two production-only migrations, missing staging and unverified backup/Hostinger artifact; never replay baseline migrations.

- Audit decision: retain a curated 13-script runtime. Additional localStorage payout, shift and draft layers have no callers in the core workflows and can imply persisted server state or restore another account's drafts. Remove their loading and the unused algorithm-only extensions; keep source/tests for future deliberate integration. Table enhancement now consumes `shine:rendered`, with no body-wide observer.

## Verification evidence

2026-09-23: 116 tests passed, including eight new behavioral regression tests. Build, JavaScript syntax, PHP lint, preview safety and frontend packaging passed. Independent review findings were reproduced and fixed before publication. No production data or backend changes.

## Follow-up: navigation and table feedback

Browser verification on 2026-09-23 confirmed no active owner tab: the renderer parsed single-quoted onclick attributes while client navigation uses double quotes. Use explicit `data-route` and `aria-current`, map job/booking details to their parent tab and strip booking query parameters.

Actual-code tests also reproduce text sorting failure: nonnumeric text was stripped to an empty string and converted to 0. Recognize numeric/money cells before comparing numbers; use natural locale text comparison otherwise. Cover both orders, Bratislava/Prague names, property IDs, and EN/SK money formatting. No API, data or authorization changes. Release/rollback follows the same frontend-only workflow.

Browser inspection also found missing jobs/cost/profit in the demo by-client finance group. The fixture now reconciles with summary/object totals; regression assertions cover those sums. Independent follow-up review caught negative EN currency sorting; reproduced and fixed before release.
