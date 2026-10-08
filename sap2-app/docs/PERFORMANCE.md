# Administrative Staff Performance & Accountability: how it works

This is an upgrade of the existing SAP2. Instructor appearances, instructor payroll, bonuses, payments, history and reports are untouched.

## 1. Database changes (all additive, safe to repeat)
Applied automatically when the server starts (and by `npm run migrate`), inside one transaction guarded by a Postgres advisory lock. Nothing is dropped or rewritten.

- **26 new tables** (including `access_codes`): `administrative_offices`, `office_responsibilities`, `office_kpis`, `kpi_results`, `meetings`, `meeting_attendance`, `admin_tasks`, `task_assignments`, `task_evidence`, `admin_activities`, `admin_attendance`, `weekly_reports`, `deliverables`, `performance_settings`, `performance_months`, `performance_inputs`, `performance_reviews`, `performance_components`, `performance_overrides`, `performance_history`, `performance_comments`, `performance_audit_logs`, `performance_alerts`, `staff_access`, `access_codes`, `office_title_map`.
- **`staff.office_id`** (nullable): the office a staff member belongs to.
- **`payments`**: new nullable columns `base_salary, performance_score, recommended_pay, approved_pay`, recorded when an administrative salary is paid. Old rows keep NULL.
- **`performance_history` is append-only**: a database trigger blocks UPDATE and DELETE, so monthly snapshots cannot be altered.
- Seeded once (never overwritten if you edit them): the 7 offices, their responsibilities and KPIs from the Operations Manual, default settings, and a role-title to office map.
- Existing admin staff are mapped to an office only when the title matches clearly. Anything unclear (e.g. "Assistant Program Manager") is flagged "needs an office" for management to confirm. Nothing is guessed.

## 2. The score (calculated on the server)
Six components, each 0–100, combined with weights set in **Settings** (default total 100):

| Component | Default weight | Source |
|---|---|---|
| Task completion | 30 | verified tasks; priority-weighted; late work earns a reduced share |
| Office KPI performance | 30 | KPI results for the staff member's office (some KPIs auto-calculate); total KPI influence is capped at the KPI weight |
| Attendance & punctuality | 15 | daily attendance, meeting attendance, punctuality (grace minutes configurable) |
| Weekly reports | 10 | approved reports, on time |
| Productivity / deliverables | 10 | approved deliverables, quality, timeliness |
| Teamwork & professionalism | 5 | management rating 0–10 |

Only work that management has **verified/approved** counts. Staff submit; management verifies; nobody verifies their own work.
If a component has no data yet, the setting `missing_component_policy` decides: `EXCLUDE` (default) re-balances the other weights so people are not punished for data that does not exist, or `ZERO`. The profile shows a "Data check" and the score is marked Incomplete.
Management can adjust a component, but only with a written reason; the system score is kept next to the adjusted one.

## 3. Payment policy (all editable in Settings)
| Score | Default band | Recommended pay |
|---|---|---|
| below 30% | Critical | 0% of salary |
| 30% to under 70% | Needs improvement / Moderate | 50% of salary |
| 70% and above | Strong / Excellent | 100% of salary |

Two consecutive months below 30% show **EXIT / MANAGEMENT REVIEW REQUIRED**. This is a flag only: SAP2 never terminates, deactivates or changes the pay of anyone automatically. Management records a decision (retain / improvement plan / exit) with a reason.

## 4. Payroll integration
Five separate figures are kept: **base salary → score → recommended pay → management-approved pay → actual paid amount**.
- Finalizing a score freezes it and stores recommended pay. It does **not** approve or pay anything.
- Management approves on the profile, the closing tab or the Payroll page (`Approve recommended pay`). Approved pay may differ from the recommendation only with a reason and never exceeds base salary.
- On the Payroll page an administrative row is "Awaiting approval" and cannot be ticked or paid until approved (setting `enforce_payroll_approval`, on by default). Bonuses work as before.
- Staff marked as **both** keep instructor earnings (appearances × rate) completely independent of the administrative score.
- `POST /api/payroll/pay` records `base_salary, performance_score, recommended_pay, approved_pay` on the payment and skips unapproved administrative rows.

## 5. Months, history, audit
- **Month closing** lists blockers (unfinalized scores, missing office) and warnings (missing reports/attendance/KPIs). Warnings need an explicit "accept incomplete data". Closing locks tasks, attendance, reports, KPI results and scores for that month and writes snapshots to the append-only history. Reopening needs a reason.
- **Audit trail**: who, what, which record, old value, new value, reason, when. Covers score adjustments, KPI/office/settings changes, verification, approvals, month close/reopen, warnings and decisions.
- **Alerts** ("Attention required"): overdue tasks, missing reports, low attendance, repeated lateness, KPIs missed, below payment line, exit review.

## 6. Screens
Administrative Performance (dashboard, scoreboard, offices & KPIs, month closing, settings) · Tasks (+ deliverables) · Staff Attendance · Meetings · Weekly Reports (+ daily activities) · Office KPIs · Performance Reports (8 types, print, CSV) · enhanced Administrative Staff page · Payroll page with score / recommended / approved / paid columns · Staff portal (own tasks, activities, weekly report, deliverables). Colours always come with a text label and a percentage.

## 7. Login page and access codes
The login page has two tabs:
- **Administrator:** one private administrator access code (`ADMIN-XXXX-XXXX-XXXX`).
- **Staff:** the staff member picks their office, enters that office's private code (for example `TECH-XXXXX-XXXXX`), then picks their name. They can only see and submit their own work.

Management regenerates any code under **Administrative Performance → Settings → Access codes**. A new code stops the old one working at once, and is shown only once. Optionally, **Administrative Staff → Personal code** gives one person their own code (staff then choose "I have a personal code instead").
Initial codes ship as hashes in `data/access-seed.json`. They are installed on first start and never overwrite codes that already exist. An office code is shared by everyone in the office, so a colleague who knows it could pick another person's name; personal codes avoid that.
