# SAP2 Administrative Performance API

## Signing in (every API route except `/api/health` and `/api/auth/*` needs it)
- **Administrator:** header `x-api-key: <administrator access code>` (an `API_KEY` environment variable, if set, is also accepted). Optional `x-actor: <name>` is recorded in the audit trail.
- **Staff, office code:** headers `x-staff-id: <id>` + `x-office-code: <the code for that staff member's own office>`.
- **Staff, personal code (optional):** `x-staff-id` + `x-staff-code` (8-character code made by management).
- Codes are stored only as salted scrypt hashes. 10 wrong tries lock a connection for 15 minutes (HTTP 429).
- Staff requests can reach only `/api/admin/*` routes marked "own staff", and only their own records; anything else returns 403.

Public login helpers: `GET /api/auth/offices` (office names only) and `POST /api/auth/office {office_id, code}`, which returns the office's staff names (no other details) only when the office code is right.

Errors are `{ "error": "plain-language message" }` with 400 (invalid), 403, 404, 409 (conflict, e.g. month locked / already submitted).

All numbers (scores, bands, payment percentage, recommended pay) are calculated on the server. The browser never calculates them.

| Method | Path | Who | Purpose |
|---|---|---|---|
| GET | `/api/admin/settings` | management | Scoring weights, payment bands, thresholds, approval switch (PUT needs `reason`). |
| PUT | `/api/admin/settings` | management | Scoring weights, payment bands, thresholds, approval switch (PUT needs `reason`). |
| GET | `/api/admin/offices` | management or own staff | The 7 administrative offices (POST creates one). |
| POST | `/api/admin/offices` | management | The 7 administrative offices (POST creates one). |
| GET | `/api/admin/offices/:id` | management or own staff | Office with responsibilities, KPIs, staff (PATCH edits; `reason` recorded). |
| PATCH | `/api/admin/offices/:id` | management | Office with responsibilities, KPIs, staff (PATCH edits; `reason` recorded). |
| GET | `/api/admin/kpis` | management or own staff | KPI definitions (`?office_id=`); POST creates. |
| POST | `/api/admin/kpis` | management | KPI definitions (`?office_id=`); POST creates. |
| PATCH | `/api/admin/kpis/:id` | management | Edit target / weight / active (audited). |
| GET | `/api/admin/kpi-results` | management or own staff | GET: KPIs and entered results for an office/month. PUT: enter one result (rating for RATING_10/QUALITY, else actual). |
| PUT | `/api/admin/kpi-results` | management | GET: KPIs and entered results for an office/month. PUT: enter one result (rating for RATING_10/QUALITY, else actual). |
| GET | `/api/admin/staff` | management | Administrative staff with office, suggested office, access-code status. |
| POST | `/api/admin/staff/:id/office` | management | Assign an office. |
| POST | `/api/admin/staff/:id/access-code` | management | POST: create the one-time staff-portal code. DELETE: revoke. |
| DELETE | `/api/admin/staff/:id/access-code` | management | POST: create the one-time staff-portal code. DELETE: revoke. |
| GET | `/api/admin/me` | management or own staff | Signed-in actor; for staff, their own live performance. |
| GET | `/api/admin/tasks` | management or own staff | Task assignments (`?month&status&staff_id&office_id`). POST creates for staff or a whole office. |
| POST | `/api/admin/tasks` | management | Task assignments (`?month&status&staff_id&office_id`). POST creates for staff or a whole office. |
| PATCH | `/api/admin/tasks/:id` | management | PATCH edit/cancel, DELETE (only untouched tasks). |
| DELETE | `/api/admin/tasks/:id` | management | PATCH edit/cancel, DELETE (only untouched tasks). |
| POST | `/api/admin/tasks/:id/start` | management or own staff | Staff/management marks started. |
| POST | `/api/admin/tasks/:id/submit` | management or own staff | Submit output + evidence (staff or recorded by management). |
| POST | `/api/admin/tasks/:id/verify` | management | Management verifies (optional quality score). Staff can never verify. |
| POST | `/api/admin/tasks/:id/reject` | management | Management sends back; comment required. |
| GET | `/api/admin/activities` | management or own staff | Daily activity log. |
| GET | `/api/admin/activities/summary` | management or own staff | Counts today/week/month. |
| POST | `/api/admin/activities` | management or own staff | Daily activity log. |
| PATCH | `/api/admin/activities/:id` | management or own staff | Edit (staff: own, until reviewed). |
| POST | `/api/admin/activities/:id/review` | management | REVIEWED or FLAGGED. |
| GET | `/api/admin/attendance` | management or own staff | Attendance records (POST accepts `records:[…]`). Late is derived from expected time + grace. |
| POST | `/api/admin/attendance` | management | Attendance records (POST accepts `records:[…]`). Late is derived from expected time + grace. |
| PATCH | `/api/admin/attendance/:id` | management | Correct a record (reason required). |
| GET | `/api/admin/meetings` | management or own staff | Meetings with attendance counts. |
| GET | `/api/admin/meetings/:id` | management or own staff | Meeting detail / edit. |
| POST | `/api/admin/meetings` | management | Meetings with attendance counts. |
| PATCH | `/api/admin/meetings/:id` | management | Meeting detail / edit. |
| POST | `/api/admin/meetings/:id/attendance` | management | Record attendance (also feeds staff attendance). |
| POST | `/api/admin/meetings/:id/convert-actions` | management | Turn action points into tasks. |
| GET | `/api/admin/reports` | management or own staff | Weekly reports (POST saves draft or `submit:true`). |
| POST | `/api/admin/reports` | management or own staff | Weekly reports (POST saves draft or `submit:true`). |
| PATCH | `/api/admin/reports/:id` | management or own staff | Edit draft. |
| POST | `/api/admin/reports/:id/review` | management | APPROVED / REJECTED. |
| GET | `/api/admin/deliverables` | management or own staff | Expected deliverables. |
| POST | `/api/admin/deliverables` | management | Expected deliverables. |
| PATCH | `/api/admin/deliverables/:id` | management | Edit. |
| POST | `/api/admin/deliverables/:id/submit` | management or own staff | Submit with evidence link. |
| POST | `/api/admin/deliverables/:id/review` | management | Approve with quality 0-10 / reject. |
| GET | `/api/admin/performance` | management | Scoreboard for a month (`?month&office_id`). |
| POST | `/api/admin/performance/calculate-all` | management | Recalculate every administrative staff member. |
| POST | `/api/admin/performance/finalize-all` | management | Finalize every review. |
| GET | `/api/admin/performance/:staff_id` | management or own staff | Full breakdown, trend, payroll position, comments, history, audit. |
| GET | `/api/admin/performance/:staff_id/history` | management or own staff | Locked monthly snapshots. |
| POST | `/api/admin/performance/:staff_id/calculate` | management | Store a fresh draft. |
| POST | `/api/admin/performance/:staff_id/finalize` | management | Freeze score + snapshot (`acknowledge_incomplete`). |
| POST | `/api/admin/performance/:staff_id/reopen` | management | Back to draft (reason). |
| POST | `/api/admin/performance/:staff_id/adjust` | management | Override one component (reason; value null removes). |
| PUT | `/api/admin/performance/:staff_id/teamwork` | management | Teamwork rating 0-10. |
| POST | `/api/admin/performance/:staff_id/comments` | management | COMMENT / WARNING / REVIEW_NOTE. |
| POST | `/api/admin/performance/:staff_id/decision` | management | RETAIN / IMPROVEMENT_PLAN / EXIT record (never automatic). |
| GET | `/api/admin/months/:month` | management | Closing checklist (BLOCK / WARN). |
| POST | `/api/admin/months/:month/close` | management | Lock the month (needs `acknowledge_incomplete` if warnings). |
| POST | `/api/admin/months/:month/reopen` | management | Reopen with reason. |
| POST | `/api/admin/payroll/approve` | management | Management approves pay: `{month, items:[{staff_id, approved_pay?, reason?}]}`. Does not pay. |
| GET | `/api/admin/alerts` | management | Open alerts for a month (`?month`). |
| POST | `/api/admin/alerts/:id/ack` | management | Acknowledge. |
| GET | `/api/admin/audit` | management | Audit trail (`?staff_id&month&action`). |
| GET | `/api/admin/dashboard` | management | Management dashboard figures. |
| GET | `/api/admin/offices/:id/dashboard` | management | Office dashboard: score, tasks, attendance, reports, KPI status, quarter trend. `?month=` |
| GET | `/api/admin/performance-reports/:type` | management | Types: monthly-performance, office-performance, attendance, task-completion, kpi, payroll-performance, staff-history, at-risk. Filters `month, office_id, staff_id, band`. |

## Existing routes that changed (additive only)
- `GET /api/payroll?month=` — administrative rows now also carry `base_salary, performance_score, performance_band, recommended_pay, approved_pay, perf_status, actual_paid`. Status can be `Awaiting approval`.
- `POST /api/payroll/pay` — administrative rows without management approval are skipped and returned in `skipped[]` (when `enforce_payroll_approval` is on). Instructor rows behave exactly as before.
- `GET /api/staff`, appearances, bonuses, payments, dashboard, health — unchanged.
