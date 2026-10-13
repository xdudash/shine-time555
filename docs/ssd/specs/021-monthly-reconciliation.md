# Monthly reconciliation by property

## Expected behaviour

- Finance > Statements opens a single selected-month view, grouped by property instead of a large list of finance KPIs and separate party-only pages.
- Each property row shows completed-cleaning count, the total/paid/outstanding amounts for clients, and separately total/paid/outstanding payouts for cleaners.
- Each row can record the outstanding client receipts or cleaner payouts. Client and cleaner sides are settled independently and use the existing append-only settlement ledger.
- Expanding a property shows each completed cleaning in the month with its service date, client amount, cleaner amount and paid/outstanding state. Before any payment has been recorded, an administrator may correct date or total amounts inline and must give a reason.
- A correction is recorded as a job event. Once either side has a settlement, the date and financial totals become read-only; corrections must use a refund/return settlement rather than rewriting history.
- The default recurring-schedule view shows active schedules that have not ended. Paused/expired schedules remain available behind an explicit history toggle. Weekdays display in Monday-to-Sunday order, and a schedule can be edited without deleting the generated jobs.

## Deployment gate

This change adds SQL functions and an additive API route. Tests do not imply a production migration or Edge Function deployment. Apply the new migration and deploy the compatible st-api before uploading the updated frontend; verify the live customer data with a controlled test payment and an unpaid correction case.
