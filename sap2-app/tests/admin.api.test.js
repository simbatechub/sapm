"use strict";
// End-to-end workflow tests: real API routes + engine + service layer running on the in-memory store.
const test = require("node:test");
const assert = require("node:assert/strict");
const { memoryStore } = require("../src/admin/store");
const { seedDefaults } = require("../src/admin/migrate");
const { createApi } = require("../src/admin/api");
const P = require("../src/admin/performance");
const { adminPayrollRow } = require("../src/admin/payroll");
const seed = require("../data/seed.json");

const TODAY = "2026-10-20";
const MGT = { role: "management", name: "Mr Billy" };
async function setup() {
  const store = memoryStore();
  for (const s of seed) await store.insert("staff", { name: s.name, email: s.email, phone: s.phone, bank: s.bank, account_number: s.account_number, staff_type: s.staff_type, role: s.role, monthly_salary: s.monthly_salary, per_appearance_rate: 20000 });
  const summary = await seedDefaults(store);
  const api = createApi({ store, today: () => TODAY });
  const call = async (method, path, { query, body, actor = MGT } = {}) => { const r = await api.handle(method, path, { query, body, actor }); return r || { status: 404, body: null }; };
  const ok = async (...a) => { const r = await call(...a); assert.equal(r.status, 200, `${a[0]} ${a[1]} -> ${r.status} ${JSON.stringify(r.body)}`); return r.body; };
  const staff = Object.fromEntries((await store.find("staff")).map((s) => [s.name, s]));
  return { store, api, call, ok, staff, summary };
}
const staffActor = (s) => ({ role: "staff", staffId: s.id, name: s.name });

test("seeding: 7 offices from the manual, roles mapped, unmatched role flagged (not changed)", async () => {
  const { ok, staff, summary, store } = await setup();
  const offices = await ok("GET", "/offices"); assert.equal(offices.length, 7);
  assert.equal((await store.find("office_responsibilities")).length, 11 + 11 + 11 + 11 + 15 + 15 + 20);
  assert.equal(staff["Chidozie Collins Achusiogu"].office_id === null, false);
  const list = await ok("GET", "/staff"); const fav = list.find((s) => s.name === "Favour Okundare");
  assert.equal(fav.needs_office, true); assert.equal(fav.suggested_office, "Project Manager"); // suggestion only
  assert.ok(summary.needs_office.some((x) => x.includes("Favour Okundare")));
  assert.equal(list.find((s) => s.name === "Johnson Esther Oyimeh").office, "Research, Partnerships & Innovation (ORPI)"); // "Research & Partnership" mapped
  // idempotent: running again creates nothing new
  const again = await seedDefaults(store); assert.equal(again.offices_created, 0); assert.equal((await store.find("administrative_offices")).length, 7);
  // instructors are never given an office / appear in admin lists
  assert.ok(!list.some((s) => s.name === "Larry"));
  await ok("POST", `/staff/${fav.id}/office`, { body: { office_id: fav.suggested_office_id } });
  assert.equal((await ok("GET", "/staff")).find((s) => s.id === fav.id).office, "Project Manager");
});

test("office, KPI configuration without code changes + audit trail", async () => {
  const { ok, call, store } = await setup();
  const office = (await ok("GET", "/offices")).find((o) => o.code === "CONTENT_CREATOR");
  const detail = await ok("GET", `/offices/${office.id}`); assert.equal(detail.kpis.length, 9);
  const k = detail.kpis.find((x) => x.name === "Timely delivery of content"); assert.equal(Number(k.target), 95);
  await ok("PATCH", `/kpis/${k.id}`, { body: { target: 90, weight: 20, reason: "Revised target" } });
  const audit = await ok("GET", "/audit", { query: { action: "KPI_CONFIG_CHANGED" } }); assert.equal(audit.length, 1); assert.equal(audit[0].new_value.target, 90); assert.equal(audit[0].old_value.target, 95);
  const nk = await ok("POST", "/kpis", { body: { office_id: office.id, name: "Newsletter issues sent", measurement_type: "NUMBER", target: 4, weight: 10, frequency: "MONTHLY" } }); assert.equal(nk.active, true);
  assert.equal((await call("POST", "/kpis", { body: { office_id: office.id, name: "x", measurement_type: "BANANA" } })).status, 400);
  await ok("PATCH", `/offices/${office.id}`, { body: { responsibilities: ["One", "Two"], reason: "trim" } });
  assert.equal((await store.find("office_responsibilities", { office_id: office.id })).length, 2);
  assert.equal((await call("GET", "/settings", { actor: staffActor({ id: 1, name: "x" }) })).status, 403);
});

test("tasks: individual / office / multiple; staff submit, only management verifies; scoping", async () => {
  const { ok, call, staff, store } = await setup();
  const ada = staff["Adelana Victor"], isi = staff["Isibor Blessing"], om = staff["Omotuemen Favour"];
  const t1 = await ok("POST", "/tasks", { body: { title: "Weekly content calendar", staff_ids: [ada.id], due_date: "2026-10-15", priority: "HIGH", expected_output: "Calendar link" } });
  const t2 = await ok("POST", "/tasks", { body: { title: "Office-wide tidy up", scope: "OFFICE", office_id: ada.office_id, due_date: "2026-10-25" } }); assert.equal(t2.assignees.length, 1);
  const t3 = await ok("POST", "/tasks", { body: { title: "Multi-person job", staff_ids: [ada.id, isi.id, om.id], due_date: "2026-10-18" } }); assert.equal(t3.assignees.length, 3);
  { const rows = (await ok("GET", "/tasks")).filter((r) => r.task_id === t3.id); const ofs = { [ada.id]: ada.office_id, [isi.id]: isi.office_id, [om.id]: om.office_id };
    for (const r of rows) assert.equal(r.office_id, ofs[r.staff_id]); // each row shows the assignee's own office
    await store.update("admin_tasks", { id: t3.id }, { office_id: ada.office_id }); // legacy task stamped with one office
    for (const r of (await ok("GET", "/tasks")).filter((r) => r.task_id === t3.id)) assert.equal(r.office_id, ofs[r.staff_id]); }
  assert.equal((await call("POST", "/tasks", { body: { title: "Bad", staff_ids: [staff["Larry"].id], due_date: "2026-10-18" } })).status, 400); // instructor-only
  assert.equal((await call("POST", "/tasks", { body: { title: "x", staff_ids: [ada.id], due_date: "2026-10-18" }, actor: staffActor(ada) })).status, 403);
  const A = staffActor(ada);
  const mine = await ok("GET", "/tasks", { actor: A }); assert.ok(mine.length === 3 && mine.every((t) => t.staff_id === ada.id));
  assert.equal((await ok("GET", "/tasks", { actor: A, query: { month: "2026-10" } })).find((t) => t.task_id === t1.id).status, "OVERDUE"); // due Oct 15, not submitted
  assert.equal((await call("GET", "/tasks", { actor: A, query: { staff_id: isi.id } })).status, 403);
  assert.equal((await call("POST", `/tasks/${t1.id}/submit`, { actor: A, body: {} })).status, 400); // nothing to submit
  const sub = await ok("POST", `/tasks/${t1.id}/submit`, { actor: A, body: { actual_output: "Done", evidence_url: "https://x.example/cal", evidence: [{ kind: "URL", reference: "https://x.example/cal" }] } });
  assert.equal(sub.status, "SUBMITTED"); assert.equal(sub.submitted_date, TODAY);
  assert.equal((await call("POST", `/tasks/${t1.id}/verify`, { actor: A, body: { staff_id: ada.id } })).status, 403); // staff can NOT verify
  assert.equal((await call("POST", `/tasks/${t1.id}/submit`, { actor: staffActor(isi), body: { actual_output: "x" } })).status, 404); // not assigned to Isibor
  const v = await ok("POST", `/tasks/${t1.id}/verify`, { body: { staff_id: ada.id, performance_score: 90, comment: "Good" } });
  assert.equal(v.status, "VERIFIED"); assert.equal(v.verified_by, "Mr Billy");
  assert.equal((await call("POST", `/tasks/${t1.id}/verify`, { body: { staff_id: ada.id } })).status, 409); // already verified
  // reject path -> back to in progress with a mandatory comment
  await ok("POST", `/tasks/${t3.id}/submit`, { actor: A, body: { actual_output: "attempt" } });
  assert.equal((await call("POST", `/tasks/${t3.id}/reject`, { body: { staff_id: ada.id } })).status, 400);
  const rj = await ok("POST", `/tasks/${t3.id}/reject`, { body: { staff_id: ada.id, comment: "Missing evidence" } }); assert.equal(rj.status, "IN_PROGRESS"); assert.equal(rj.verification_status, "REJECTED");
  assert.equal((await call("DELETE", `/tasks/${t3.id}`)).status, 409); // has progress -> cancel instead
  await ok("PATCH", `/tasks/${t2.id}`, { body: { cancelled: true, reason: "Not needed" } });
  assert.equal((await ok("GET", "/tasks", { query: { staff_id: ada.id } })).find((t) => t.task_id === t2.id).status, "CANCELLED");
  await ok("DELETE", `/tasks/${(await ok("POST", "/tasks", { body: { title: "Temp", staff_ids: [ada.id], due_date: "2026-10-30" } })).id}`);
});

test("activities, attendance (late detection, correction audit), meetings (mirrored attendance, action points -> tasks)", async () => {
  const { ok, call, staff, store } = await setup();
  const ada = staff["Adelana Victor"], A = staffActor(ada);
  const act = await ok("POST", "/activities", { actor: A, body: { activity: "Edited event video", minutes_spent: 120, activity_date: TODAY } });
  assert.equal((await ok("GET", "/activities/summary", { actor: A })).today, 1);
  assert.equal((await call("POST", "/activities", { actor: A, body: { activity: "x", staff_id: staff["Isibor Blessing"].id } })).status, 403);
  await ok("POST", `/activities/${act.id}/review`, { body: { review_status: "REVIEWED" } });
  assert.equal((await call("PATCH", `/activities/${act.id}`, { actor: A, body: { activity: "changed" } })).status, 403); // locked after review
  // attendance
  const late = await ok("POST", "/attendance", { body: { staff_id: ada.id, date: "2026-10-05", expected_time: "08:30", arrival_time: "09:10" } }); assert.equal(late.status, "LATE"); assert.equal(late.late_minutes, 40);
  const grace = await ok("POST", "/attendance", { body: { staff_id: ada.id, date: "2026-10-06", expected_time: "08:30", arrival_time: "08:38" } }); assert.equal(grace.status, "PRESENT");
  assert.equal((await call("POST", "/attendance", { body: { staff_id: ada.id, date: "2026-10-06", expected_time: "08:30", arrival_time: "08:38" } })).status, 409); // duplicate
  assert.equal((await call("PATCH", `/attendance/${late.id}`, { body: { status: "PRESENT" } })).status, 400); // reason required
  await ok("PATCH", `/attendance/${late.id}`, { body: { status: "EXCUSED", reason: "Medical note provided" } });
  const aud = await ok("GET", "/audit", { query: { action: "ATTENDANCE_CORRECTED" } }); assert.equal(aud[0].old_value.status, "LATE"); assert.equal(aud[0].new_value.status, "EXCUSED"); assert.equal(aud[0].reason, "Medical note provided");
  // meetings
  const all = (await store.find("staff", { staff_type: ["admin", "both"] }));
  const m = await ok("POST", "/meetings", { body: { title: "Monthly all-hands", meeting_date: "2026-10-08", meeting_time: "10:00", meeting_type: "MANDATORY", agenda: "Targets", action_points: [{ text: "Prepare Q4 plan", assignee_ids: [ada.id], due_date: "2026-10-28" }, { text: "Unassigned point" }] } });
  assert.equal((await store.find("meeting_attendance", { meeting_id: m.id })).length, all.length);
  await ok("POST", `/meetings/${m.id}/attendance`, { body: { records: [{ staff_id: ada.id, status: "PRESENT", arrival_time: "10:25" }, { staff_id: staff["Isibor Blessing"].id, status: "ABSENT" }] } });
  const mirrored = await store.find("admin_attendance", { staff_id: ada.id, meeting_id: m.id }); assert.equal(mirrored.length, 1); assert.equal(mirrored[0].status, "LATE"); assert.equal(mirrored[0].event_type, "MANDATORY_MEETING");
  const conv = await ok("POST", `/meetings/${m.id}/convert-actions`); assert.equal(conv.created, 1); assert.equal(conv.skipped, 1);
  assert.equal((await ok("GET", "/tasks", { query: { staff_id: ada.id } })).filter((t) => t.title === "Prepare Q4 plan").length, 1);
  assert.equal((await call("GET", `/meetings/${m.id}`, { actor: staffActor(staff["Larry"]) })).status, 403);
  assert.equal((await call("PATCH", `/attendance/${mirrored[0].id}`, { body: { status: "PRESENT", reason: "x" } })).status, 409); // edit from the meeting page
});

test("weekly reports: on-time vs late flags, review workflow; deliverables workflow", async () => {
  const { ok, call, staff } = await setup(); const ada = staff["Adelana Victor"], A = staffActor(ada);
  const draft = await ok("POST", "/reports", { actor: A, body: { week_start: "2026-10-14", activities: "Edited videos" } }); assert.equal(draft.status, "DRAFT"); assert.equal(draft.week_start, "2026-10-12");
  assert.equal((await call("POST", "/reports", { actor: A, body: { week_start: "2026-10-12", submit: true, activities: "", achievements: "" } })).status, 400);
  const sub = await ok("POST", "/reports", { actor: A, body: { week_start: "2026-10-12", activities: "Edited videos", achievements: "5 posts", submit: true } }); assert.equal(sub.status, "SUBMITTED"); assert.equal(sub.on_time, true); // due Oct 20 (Mon)
  const lateRep = await ok("POST", "/reports", { actor: A, body: { week_start: "2026-10-05", activities: "x", submit: true } }); assert.equal(lateRep.on_time, false);
  assert.equal((await call("POST", `/reports/${sub.id}/review`, { actor: A, body: { decision: "APPROVED" } })).status, 403);
  assert.equal((await call("POST", `/reports/${sub.id}/review`, { body: { decision: "REJECTED" } })).status, 400);
  await ok("POST", `/reports/${sub.id}/review`, { body: { decision: "APPROVED", comment: "Good" } });
  assert.equal((await call("POST", "/reports", { actor: A, body: { week_start: "2026-10-12", activities: "edit" } })).status, 409); // approved: locked
  const d = await ok("POST", "/deliverables", { body: { staff_id: ada.id, title: "Hackathon highlight video", deliverable_type: "Video", expected_date: "2026-10-10" } });
  const ds = await ok("POST", `/deliverables/${d.id}/submit`, { actor: A, body: { evidence_url: "https://x.example/v" } }); assert.equal(ds.late, true);
  assert.equal((await call("POST", `/deliverables/${d.id}/review`, { actor: A, body: { decision: "APPROVED" } })).status, 403);
  const ap = await ok("POST", `/deliverables/${d.id}/review`, { body: { decision: "APPROVED", quality_rating: 9 } }); assert.equal(ap.status, "APPROVED");
});

async function populateOctober(ok, ada) {
  // a realistic month for Adelana Victor (Content Creator)
  const t = await ok("POST", "/tasks", { body: { title: "Calendar", staff_ids: [ada.id], due_date: "2026-10-25" } });
  const A = staffActor(ada); await ok("POST", `/tasks/${t.id}/submit`, { actor: A, body: { actual_output: "ok" } });
  await ok("POST", `/tasks/${t.id}/verify`, { body: { staff_id: ada.id, performance_score: 100 } });
  for (const d of ["2026-10-01", "2026-10-02", "2026-10-05", "2026-10-06"]) await ok("POST", "/attendance", { body: { staff_id: ada.id, date: d, expected_time: "08:30", arrival_time: "08:30" } });
}

test("performance: calculate, KPI results, teamwork, payment recommendation, finalize rules", async () => {
  const { ok, call, staff } = await setup(); const ada = staff["Adelana Victor"]; const M = "2026-10";
  await populateOctober(ok, ada);
  const c0 = await ok("POST", `/performance/${ada.id}/calculate`, { body: { month: M } });
  assert.equal(c0.calc.components.find((x) => x.component === "task").score_pct, 100);
  assert.equal(c0.calc.incomplete, true); assert.ok(c0.calc.data_quality.warnings.length);
  // KPI result with a reason requirement on change; evidence of management entry
  const office = await ok("GET", `/offices/${ada.office_id}`); const q = office.kpis.find((k) => k.name === "Quality of event documentation");
  await ok("PUT", "/kpi-results", { body: { kpi_id: q.id, staff_id: ada.id, month: M, rating: 6 } });
  assert.equal((await call("PUT", "/kpi-results", { body: { kpi_id: q.id, staff_id: ada.id, month: M, rating: 9 } })).status, 400);
  await ok("PUT", "/kpi-results", { body: { kpi_id: q.id, staff_id: ada.id, month: M, rating: 9, reason: "Re-assessed with new evidence" } });
  assert.equal((await call("PUT", "/kpi-results", { body: { kpi_id: 9999, staff_id: ada.id, month: M, rating: 9 } })).status, 404);
  const other = (await ok("GET", "/offices")).find((o) => o.code === "TECH_OPS"); const foreign = (await ok("GET", `/offices/${other.id}`)).kpis[0];
  assert.equal((await call("PUT", "/kpi-results", { body: { kpi_id: foreign.id, staff_id: ada.id, month: M, rating: 9 } })).status, 400); // wrong office KPI
  await ok("PUT", `/performance/${ada.id}/teamwork`, { body: { month: M, rating: 8, comment: "Great teammate" } });
  assert.equal((await call("PUT", `/performance/${ada.id}/teamwork`, { body: { month: M, rating: 5 } })).status, 400);
  // fixed score scenarios from the brief: salary 50,000 -> 65% = 25,000 ; 82% = full ; 27% = 0
  await ok("PUT", "/settings", { body: { settings: { weights: { task: 100, kpi: 0, attendance: 0, reports: 0, productivity: 0, teamwork: 0 } } } });
  for (const [score, pay, status, band] of [[65, 20000, "PARTIAL_PAYMENT", "MODERATE"], [82, 40000, "FULL_PAYMENT", "STRONG"], [27, 0, "NO_PAYMENT", "CRITICAL"], [50, 20000, "PARTIAL_PAYMENT", "MODERATE"], [40, 20000, "PARTIAL_PAYMENT", "NEEDS_IMPROVEMENT"]]) {
    await ok("POST", `/performance/${ada.id}/adjust`, { body: { month: M, component: "task", value: score, reason: "Test scenario" } });
    const r = await ok("POST", `/performance/${ada.id}/calculate`, { body: { month: M } });
    assert.equal(r.calc.final_score, score); assert.equal(r.calc.recommended_payment, pay); assert.equal(r.calc.payment_status, status); assert.equal(r.calc.performance_band, band); assert.equal(r.calc.base_salary, 40000); assert.equal(r.calc.recommended_payment, Math.round((40000 * r.calc.payment_percentage) / 100));
  }
  assert.equal((await call("POST", `/performance/${ada.id}/adjust`, { body: { month: M, component: "task", value: 50 } })).status, 400); // reason mandatory
  assert.ok((await ok("GET", "/audit", { query: { staff_id: ada.id, action: "SCORE_ADJUSTED" } })).length >= 5);
  // clients cannot send a score
  const hack = await ok("POST", `/performance/${ada.id}/calculate`, { body: { month: M, final_score: 95, recommended_payment: 99999 } }); assert.notEqual(hack.calc.final_score, 95);
  // finalize: incomplete data needs explicit acknowledgement
  await ok("PUT", "/settings", { body: { settings: { weights: { task: 30, kpi: 30, attendance: 15, reports: 10, productivity: 10, teamwork: 5 } } } });
  await ok("POST", `/performance/${ada.id}/adjust`, { body: { month: M, component: "task", value: null, reason: "Remove test override" } });
  const need = await call("POST", `/performance/${ada.id}/finalize`, { body: { month: M } }); assert.equal(need.status, 409); assert.equal(need.body.needs_acknowledgement, true);
  const fin = await ok("POST", `/performance/${ada.id}/finalize`, { body: { month: M, acknowledge_incomplete: true } }); assert.equal(fin.review.status, "FINALIZED");
  assert.equal((await call("POST", `/performance/${ada.id}/calculate`, { body: { month: M } })).status, 409); // locked after finalize
  assert.equal((await call("PUT", "/kpi-results", { body: { kpi_id: q.id, staff_id: ada.id, month: M, rating: 3, reason: "x" } })).status, 409);
  assert.equal((await call("POST", `/performance/${ada.id}/reopen`, { body: { month: M } })).status, 400); // reason required
  await ok("POST", `/performance/${ada.id}/reopen`, { body: { month: M, reason: "Late evidence arrived" } });
  assert.equal((await ok("GET", `/performance/${ada.id}`, { query: { month: M } })).state, "DRAFT");
});

test("payroll integration: recommendation -> approval -> payment row; instructors untouched; 'both' staff", async () => {
  const { ok, call, staff, store } = await setup(); const ada = staff["Adelana Victor"], chi = staff["Chidozie Collins Achusiogu"]; const M = "2026-10";
  await populateOctober(ok, ada);
  await ok("POST", `/performance/${ada.id}/adjust`, { body: { month: M, component: "task", value: 100, reason: "t" } });
  assert.equal((await call("POST", "/payroll/approve", { body: { month: M, items: [{ staff_id: ada.id }] } })).status, 409); // not finalized yet
  await ok("POST", `/performance/${ada.id}/finalize`, { body: { month: M, acknowledge_incomplete: true } });
  // before approval the payroll row is "awaiting approval"
  let rv = await store.one("performance_reviews", { staff_id: ada.id, month: M });
  let row = adminPayrollRow({ enforce: true, salary: ada.monthly_salary, review: rv }); assert.equal(row.awaiting, true); assert.equal(row.extra.perf_status, "FINALIZED"); assert.equal(row.extra.recommended_pay, rv.recommended_pay);
  assert.equal(adminPayrollRow({ enforce: true, salary: 50000, review: null }).extra.perf_status, "NOT_CALCULATED");
  assert.equal(adminPayrollRow({ enforce: false, salary: 50000, review: null }).awaiting, false); // setting off = old behaviour
  const rec = rv.recommended_pay;
  assert.equal((await call("POST", "/payroll/approve", { body: { month: M, items: [{ staff_id: ada.id, approved_pay: rec + 1 }] } })).status, 400); // differs, needs reason
  assert.equal((await call("POST", "/payroll/approve", { body: { month: M, items: [{ staff_id: ada.id, approved_pay: 999999, reason: "x" }] } })).status, 400); // above salary
  const ap = await ok("POST", "/payroll/approve", { body: { month: M, items: [{ staff_id: ada.id }] } }); assert.equal(ap.approved[0].approved_pay, rec);
  rv = await store.one("performance_reviews", { staff_id: ada.id, month: M }); row = adminPayrollRow({ enforce: true, salary: ada.monthly_salary, review: rv }); assert.equal(row.awaiting, false); assert.equal(row.base, rec); assert.equal(row.extra.perf_status, "APPROVED");
  assert.equal((await ok("GET", "/audit", { query: { action: "PAYROLL_APPROVED" } })).length, 1);
  // a pay approval is recorded; marking as paid is still the existing payroll action (never done here)
  assert.equal((await store.find("payments")).length, 0);
  // instructor-only staff are not administrative: no review, no approval
  assert.equal((await call("POST", `/performance/${staff["Larry"].id}/calculate`, { body: { month: M } })).status, 400);
  assert.equal((await call("POST", "/payroll/approve", { body: { month: M, items: [{ staff_id: staff["Larry"].id }] } })).status, 404);
  // 'both' staff: admin side gets a performance review; salary only (instructor earnings are not part of it)
  assert.equal(chi.staff_type, "both"); const cr = await ok("POST", `/performance/${chi.id}/calculate`, { body: { month: M } }); assert.equal(cr.calc.base_salary, chi.monthly_salary);
  const sb = await ok("GET", "/performance", { query: { month: M } }); assert.ok(sb.rows.some((r) => r.staff_id === chi.id)); assert.ok(!sb.rows.some((r) => r.name === "Larry"));
  // a paid month can no longer be reopened
  await store.insert("payments", { staff_id: ada.id, pay_type: "admin", month: M, amount: rec, reference: "R1" });
  assert.equal((await call("POST", `/performance/${ada.id}/reopen`, { body: { month: M, reason: "oops" } })).status, 409);
});

test("exit review: two months below 30% -> flagged, payment 0, never automatic", async () => {
  const { ok, call, staff, store } = await setup(); const isi = staff["Isibor Blessing"];
  for (const M of ["2026-08", "2026-09"]) {
    const t = await ok("POST", "/tasks", { body: { title: "Report " + M, staff_ids: [isi.id], due_date: `${M}-10` } }); void t; // never done -> missed
    await ok("POST", "/attendance", { body: { staff_id: isi.id, date: `${M}-03`, status: "ABSENT" } });
    await ok("PUT", `/performance/${isi.id}/teamwork`, { body: { month: M, rating: 1 } });
    const r = await ok("POST", `/performance/${isi.id}/calculate`, { body: { month: M } }); assert.ok(r.calc.final_score < 30, `${M}: ${r.calc.final_score}`);
    if (M === "2026-08") assert.equal(r.calc.exit_review_required, false);
  }
  const sep = await ok("GET", `/performance/${isi.id}`, { query: { month: "2026-09" } });
  assert.equal(sep.calc.exit_review_required, true); assert.equal(sep.calc.exit_review_label, "EXIT / MANAGEMENT REVIEW REQUIRED"); assert.equal(sep.calc.recommended_payment, 0);
  const alerts = await ok("GET", "/alerts", { query: { month: "2026-09" } }); assert.ok(alerts.some((a) => a.kind === "TWO_MONTHS_BELOW_30" && a.severity === "CRITICAL"));
  assert.ok(alerts.some((a) => a.kind === "PERFORMANCE_BELOW_30"));
  const dec = await ok("POST", `/performance/${isi.id}/decision`, { body: { month: "2026-09", decision: "IMPROVEMENT_PLAN", reason: "Agreed 30-day plan" } }); assert.ok(dec.note);
  assert.equal((await store.one("staff", { id: isi.id })).active, true); // nothing changed automatically
  assert.equal((await call("POST", `/performance/${isi.id}/decision`, { body: { month: "2026-09", decision: "FIRE", reason: "x" } })).status, 400);
  const dash = await ok("GET", "/dashboard", { query: { month: "2026-09" } }); assert.deepEqual(dash.exit_review, ["Isibor Blessing"]); assert.ok(dash.below_30 >= 1);
});

test("monthly closing: checks, locking, append-only history, reopen with audit, re-close = new version", async () => {
  const { ok, call, staff, store } = await setup(); const M = "2026-09"; const M2 = "2026-10";
  const adminList = await store.find("staff", { staff_type: ["admin", "both"] });
  // an office is required for every admin staff member
  const fav = staff["Favour Okundare"]; await ok("POST", `/staff/${fav.id}/office`, { body: { office_id: (await ok("GET", "/offices")).find((o) => o.code === "PROJECT_MANAGER").id } });
  const chk = await ok("GET", `/months/${M}`); assert.ok(chk.blockers >= adminList.length); // nothing finalized yet
  const blocked = await call("POST", `/months/${M}/close`, { body: {} }); assert.equal(blocked.status, 409);
  const fa = await ok("POST", "/performance/finalize-all", { body: { month: M, acknowledge_incomplete: true } }); assert.equal(fa.results.filter((r) => r.status === "FINALIZED").length, adminList.length);
  const warn = await call("POST", `/months/${M}/close`, { body: {} }); assert.equal(warn.status, 409); assert.equal(warn.body.needs_acknowledgement, true); // warnings need confirmation
  const closed = await ok("POST", `/months/${M}/close`, { body: { acknowledge_incomplete: true, notes: "Closing September" } }); assert.equal(closed.reviews, adminList.length);
  const hist = await store.find("performance_history", { month: M }); assert.equal(hist.length, adminList.length * 2); // finalize snapshot + close snapshot
  // locked
  assert.equal((await call("POST", `/performance/${staff["Adelana Victor"].id}/calculate`, { body: { month: M } })).status, 409);
  assert.equal((await call("POST", "/attendance", { body: { staff_id: staff["Adelana Victor"].id, date: "2026-09-12", status: "PRESENT" } })).status, 409);
  assert.equal((await call("PUT", `/performance/${staff["Adelana Victor"].id}/teamwork`, { body: { month: M, rating: 9 } })).status, 409);
  // other months are unaffected
  await ok("POST", "/attendance", { body: { staff_id: staff["Adelana Victor"].id, date: "2026-10-12", status: "PRESENT" } });
  // reopen needs a reason, is audited, and re-closing adds versions instead of overwriting
  assert.equal((await call("POST", `/months/${M}/reopen`, { body: {} })).status, 400);
  await ok("POST", `/months/${M}/reopen`, { body: { reason: "Correction to attendance" } });
  assert.equal((await ok("GET", "/audit", { query: { action: "PERFORMANCE_MONTH_REOPENED" } }))[0].reason, "Correction to attendance");
  assert.equal((await store.find("performance_reviews", { month: M, status: "FINALIZED" })).length, adminList.length);
  await ok("POST", `/months/${M}/close`, { body: { acknowledge_incomplete: true } });
  const v = await store.find("performance_history", { staff_id: staff["Adelana Victor"].id, month: M }); assert.deepEqual(v.map((x) => x.version).sort(), [1, 2, 3]); // old rows kept
  const h = await ok("GET", `/performance/${staff["Adelana Victor"].id}/history`); assert.equal(h.length, 3);
  assert.ok(M2 > M);
});

test("scoreboard, dashboards, reports, staff portal privacy", async () => {
  const { ok, call, staff } = await setup(); const ada = staff["Adelana Victor"], M = "2026-10"; await populateOctober(ok, ada);
  const sb = await ok("GET", "/performance", { query: { month: M } }); assert.ok(sb.rows.length >= 6); assert.equal(sb.rows[0].rank, 1); assert.ok(sb.rows.every((r, i) => i === 0 || sb.rows[i - 1].final_score >= r.final_score));
  const dash = await ok("GET", "/dashboard", { query: { month: M } }); for (const k of ["staff_count", "average_score", "tasks", "attendance_rate", "reports", "staff_at_risk", "below_30", "on_half_pay", "full_pay", "ranking", "attention"]) assert.ok(k in dash, k);
  const od = await ok("GET", `/offices/${ada.office_id}/dashboard`, { query: { month: M } }); assert.equal(od.office.code, "CONTENT_CREATOR"); assert.ok(od.quarter.months.length === 3);
  for (const type of ["monthly-performance", "office-performance", "attendance", "task-completion", "kpi", "payroll-performance", "at-risk"]) { const r = await ok("GET", `/performance-reports/${type}`, { query: { month: M } }); assert.ok(r.columns.length && Array.isArray(r.rows), type); }
  assert.equal((await call("GET", "/performance-reports/staff-history", { query: { month: M } })).status, 400);
  assert.equal((await ok("GET", "/performance-reports/staff-history", { query: { month: M, staff_id: ada.id } })).rows.length, 0);
  assert.equal((await call("GET", "/performance-reports/nope", { query: { month: M } })).status, 404);
  assert.equal((await call("GET", "/performance-reports/attendance", { query: { month: M, office_id: ada.office_id } })).body.rows.length, 1);
  // staff portal: own data only, no others, no management data
  const A = staffActor(ada), other = staff["Isibor Blessing"];
  const me = await ok("GET", "/me", { actor: A, query: { month: M } }); assert.equal(me.staff.id, ada.id); assert.ok(me.calc.components.length === 6); assert.equal(me.audit, undefined);
  assert.equal((await call("GET", `/performance/${other.id}`, { actor: A, query: { month: M } })).status, 403);
  assert.equal((await call("GET", "/performance", { actor: A, query: { month: M } })).status, 403);
  assert.equal((await call("GET", "/dashboard", { actor: A, query: { month: M } })).status, 403);
  assert.equal((await call("GET", "/audit", { actor: A })).status, 403);
  assert.equal((await call("GET", "/attendance", { actor: A, query: { month: M, staff_id: other.id } })).status, 403);
  assert.ok((await ok("GET", "/attendance", { actor: A, query: { month: M } })).every((r) => r.staff_id === ada.id));
  assert.equal((await call("POST", `/performance/${ada.id}/adjust`, { actor: A, body: { month: M, component: "task", value: 100, reason: "me" } })).status, 403);
  assert.equal((await call("POST", "/payroll/approve", { actor: A, body: { month: M, items: [{ staff_id: ada.id }] } })).status, 403);
  // access codes
  const code = (await ok("POST", `/staff/${ada.id}/access-code`)).code; assert.match(code, /^[A-Z2-9]{8}$/);
});

test("access codes verify and are stored hashed", async () => {
  const { store, ok, staff } = await setup(); const ada = staff["Adelana Victor"];
  const code = (await ok("POST", `/staff/${ada.id}/access-code`)).code;
  const row = await store.one("staff_access", { staff_id: ada.id }); assert.ok(!JSON.stringify(row).includes(code));
  assert.ok(await P.verifyAccessCode(store, ada.id, code)); assert.ok(await P.verifyAccessCode(store, ada.id, code.toLowerCase()));
  assert.equal(await P.verifyAccessCode(store, ada.id, "WRONGCODE"), null);
  assert.equal(await P.verifyAccessCode(store, staff["Larry"].id, code), null);
});

test("settings validation", async () => {
  const { ok, call } = await setup();
  assert.equal((await call("PUT", "/settings", { body: { settings: { weights: { task: 50, kpi: 30 } } } })).status, 400); // does not add to 100
  assert.equal((await call("PUT", "/settings", { body: { settings: { bands: [{ key: "A", min: 10, pay_pct: 100 }] } } })).status, 400); // must start at 0
  assert.equal((await call("PUT", "/settings", { body: { settings: { nonsense: 1 } } })).status, 400);
  const r = await ok("PUT", "/settings", { body: { settings: { enforce_payroll_approval: false }, reason: "Temporarily" } }); assert.equal(r.settings.enforce_payroll_approval, false);
  assert.equal((await ok("GET", "/audit", { query: { action: "SETTINGS_CHANGED" } })).length, 1);
});

test("attendance can be switched off in Settings: scores and month closing stop asking for it, and it can be switched back on", async () => {
  const { ok, call, staff } = await setup();
  const M = TODAY.slice(0, 7), sid = staff["Chidozie Collins Achusiogu"].id;
  const before = await ok("GET", "/months/" + M);
  assert.ok(before.checks.some((c) => /No attendance recorded/.test(c.message)), "on by default: attendance is asked for");
  assert.equal((await call("PUT", "/settings", { body: { settings: { attendance_enabled: "no" }, reason: "x" } })).status, 400, "must be true/false");
  const saved = await ok("PUT", "/settings", { body: { settings: { attendance_enabled: false }, reason: "Staff work remotely" } });
  assert.equal(saved.settings.attendance_enabled, false);
  const off = await ok("GET", "/months/" + M);
  assert.ok(!off.checks.some((c) => /attendance/i.test(c.message)), "closing no longer mentions attendance");
  const prof = await ok("GET", "/performance/" + sid, { query: { month: M } });
  const at = prof.calc.components.find((c) => c.component === "attendance"); assert.equal(at.hidden, true); assert.equal(at.effective_weight, 0);
  await ok("PUT", "/settings", { body: { settings: { attendance_enabled: true }, reason: "Back on" } });
  assert.ok((await ok("GET", "/months/" + M)).checks.some((c) => /No attendance recorded/.test(c.message)), "switching back on restores it");
});
