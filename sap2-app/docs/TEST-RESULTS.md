# Test results (run before delivery)

| Suite | Command | Result |
|---|---|---|
| Calculation engine + workflow (in-memory store) | `npm test` | 37 / 37 passed (incl. 9 login/access-code tests) |
| Browser UI (Chromium, mock server running the real admin API) | `npm run test:ui` | 26 / 26 steps passed, no page errors |
| Database SQL (real Neon, in a rolled-back transaction) | run during development | all 156 statements OK; append-only trigger and constraints verified; nothing persisted |

Covered: payment scenarios (below 30 = 0, 30–70 = 50%, 70+ = 100%), exit review after two months below 30, KPI weight cap, task/attendance/report/deliverable scoring, verification workflow (staff cannot verify), month close/reopen and locking, payroll approval gate, instructor pay untouched, staff-portal privacy (own records only), access codes, settings validation, all 8 reports, print/CSV, mobile layout, dark/light themes.

The new `access_codes` table was not dry-run on your live Neon database; it is created on first start.

Not exercised in the build environment (no npm network there): the real Express + pg process and a Netlify deployment. The first `npm start` against your Neon database creates the new tables automatically.
