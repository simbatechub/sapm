"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const E = require("../src/admin/engine");
const { DEFAULT_SETTINGS, OFFICES } = require("../src/admin/defaults");
const S = E.mergeSettings({});
const approx = (a, b, eps = 0.011) => assert.ok(Math.abs(a - b) <= eps, `${a} !~ ${b}`);

test("payment bands: 82% full, 65% half, 27% nothing, 40-50% half (policy)", () => {
  assert.deepEqual(E.paymentFor(50000, 82, S), { base_salary: 50000, performance_score: 82, performance_band: "STRONG", band_label: "Strong", recommended_payment: 50000, payment_percentage: 100, payment_status: "FULL_PAYMENT" });
  assert.equal(E.paymentFor(50000, 65, S).recommended_payment, 25000);
  assert.equal(E.paymentFor(50000, 27, S).recommended_payment, 0);
  assert.equal(E.paymentFor(50000, 27, S).payment_status, "NO_PAYMENT");
  assert.equal(E.paymentFor(50000, 29.99, S).recommended_payment, 0);
  assert.equal(E.paymentFor(50000, 30, S).recommended_payment, 25000);
  assert.equal(E.paymentFor(50000, 40, S).recommended_payment, 25000);
  assert.equal(E.paymentFor(50000, 50, S).recommended_payment, 25000);
  assert.equal(E.paymentFor(50000, 70, S).payment_status, "FULL_PAYMENT");
  assert.equal(E.paymentFor(33333, 55, S).recommended_payment, 16667);
});

test("KPI weights: capped so one KPI cannot dominate, always sum to 1", () => {
  const sh = E.normalizeWeights([{ id: 1, weight: 90 }, { id: 2, weight: 5 }, { id: 3, weight: 5 }, { id: 4, weight: 5 }], 30);
  assert.ok(sh[1] <= 0.3 + 1e-9);
  approx(Object.values(sh).reduce((a, b) => a + b, 0), 1, 1e-9);
  const two = E.normalizeWeights([{ id: 1, weight: 99 }, { id: 2, weight: 1 }], 30); // cap impossible with 2 KPIs -> relaxes to 50%
  approx(two[1], 0.5, 1e-9);
  const eq = E.normalizeWeights([{ id: 1, weight: 0 }, { id: 2, weight: 0 }], 30); approx(eq[1], 0.5, 1e-9);
});

test("KPI ratio: capped at 100%, YES/NO, rating", () => {
  assert.equal(E.kpiRatio({ measurement_type: "PERCENTAGE", target: 95 }, 190), 1);
  approx(E.kpiRatio({ measurement_type: "NUMBER", target: 4 }, 1), 0.25, 1e-9);
  assert.equal(E.kpiRatio({ measurement_type: "YES_NO", target: 1 }, 0), 0);
  assert.equal(E.kpiRatio({ measurement_type: "QUALITY", target: 8 }, 9), 1);
  assert.equal(E.kpiRatio({ measurement_type: "QUALITY", target: 8 }, null), null);
});

const TODAY = "2026-10-20";
const task = (o) => ({ title: "t", priority: "MEDIUM", due_date: "2026-09-10", status: "TODO", cancelled: false, ...o });

test("tasks: verified on time = 100%, late = penalty, missed = 0, submitted = excluded, not-due = excluded", () => {
  const r = E.scoreTasks([
    task({ status: "VERIFIED", submitted_date: "2026-09-09" }),                     // 1.0
    task({ status: "VERIFIED", submitted_date: "2026-09-12" }),                     // 0.75
    task({ status: "TODO" }),                                                       // missed 0 (due passed)
    task({ status: "SUBMITTED" }),                                                  // excluded
    task({ status: "CANCELLED" }),                                                  // ignored
    task({ status: "TODO", due_date: "2026-09-30" }),                               // missed too (today is Oct 20)
    task({ status: "VERIFIED", submitted_date: "2026-08-01", due_date: "2026-08-02" }), // other month
  ], "2026-09", S, TODAY);
  assert.equal(r.details.counted, 4); assert.equal(r.details.awaiting_verification, 1);
  approx(r.score, (1 + 0.75) / 4, 1e-9);
  const early = E.scoreTasks([task({ status: "TODO", due_date: "2026-10-30" })], "2026-10", S, TODAY);
  assert.equal(early.score, null); assert.equal(early.details.pending_not_due, 1);
});

test("tasks: management quality score scales credit; priority weights", () => {
  const r = E.scoreTasks([
    task({ status: "VERIFIED", submitted_date: "2026-09-01", performance_score: 80, priority: "HIGH" }),
    task({ status: "TODO", priority: "LOW" }),
  ], "2026-09", S, TODAY);
  approx(r.score, (0.8 * 3) / (3 + 1), 1e-9);
});

test("attendance: excused ignored, late counts as attended, punctuality separate", () => {
  const rows = [
    { date: "2026-09-01", event_type: "WORK", status: "PRESENT" }, { date: "2026-09-02", event_type: "WORK", status: "LATE" },
    { date: "2026-09-03", event_type: "WORK", status: "ABSENT" }, { date: "2026-09-04", event_type: "WORK", status: "EXCUSED" },
    { date: "2026-09-05", event_type: "MEETING", status: "PRESENT" }, { date: "2026-09-06", event_type: "OFFICIAL_ASSIGNMENT", status: "OFFICIAL_ASSIGNMENT" },
  ];
  const r = E.scoreAttendance(rows, "2026-09", S);
  approx(r.details.daily_rate, 75, 0.01); // 3 of 4 counted (present, late, official) / (present, late, absent, official)
  assert.equal(r.details.meeting_rate, 100); assert.equal(r.details.late, 1);
  approx(r.details.punctuality_rate, 66.67, 0.01);
  assert.equal(E.scoreAttendance([], "2026-09", S).score, null);
});

test("weekly reports: weeks due counted, late = partial credit, missing = 0, unreviewed excluded", () => {
  const weeks = E.weeksOfMonth("2026-09"); assert.equal(weeks.length, 4); // Sep 7,14,21,28
  const reports = [
    { week_start: weeks[0], status: "APPROVED", on_time: true }, { week_start: weeks[1], status: "APPROVED", on_time: false },
    { week_start: weeks[2], status: "SUBMITTED", on_time: true }, // excluded
  ];
  const r = E.scoreReports(reports, "2026-09", S, TODAY); // week 4 (Sep 28) due Oct 6 < Oct 20 -> missing
  assert.equal(r.details.not_submitted, 1); assert.equal(r.details.awaiting_review, 1);
  approx(r.score, (1 + 0.6 + 0) / 3, 1e-9);
  const future = E.scoreReports([], "2026-10", S, "2026-10-02"); assert.equal(future.score, null); // nothing due yet
});

test("deliverables", () => {
  const r = E.scoreDeliverables([
    { expected_date: "2026-09-10", status: "APPROVED", quality_rating: 10, submitted_date: "2026-09-10" },
    { expected_date: "2026-09-11", status: "APPROVED", quality_rating: 10, submitted_date: "2026-09-15", late: true },
    { expected_date: "2026-09-12", status: "REJECTED" }, { expected_date: "2026-09-13", status: "EXPECTED" },
  ], "2026-09", S, TODAY);
  approx(r.score, (1 + 0.7 + 0 + 0) / 4, 1e-9);
});

const kpi = (id, o) => ({ id, office_id: 1, name: "k" + id, measurement_type: "QUALITY", target: 8, frequency: "MONTHLY", weight: 10, evidence_required: false, auto_source: null, active: true, ...o });

test("KPIs: management result, system (auto) value, missing excluded, quarterly carry-forward", () => {
  const auto = { TASK_ON_TIME: 90 };
  const r = E.scoreKpis([kpi(1, {}), kpi(2, { measurement_type: "DEADLINE", target: 90, auto_source: "TASK_ON_TIME" }), kpi(3, {}), kpi(4, { frequency: "QUARTERLY", measurement_type: "RATING_10", target: 7 })],
    [{ kpi_id: 1, month: "2026-09", rating: 4 }, { kpi_id: 4, month: "2026-07", rating: 7 }], auto, "2026-09", S);
  assert.equal(r.details.scored, 3); assert.equal(r.details.missing.length, 1);
  approx(r.score, (0.5 + 1 + 1) / 3, 1e-9);
});

function sample(over = {}) {
  const office = { id: 1, name: "Content Creator" };
  return {
    staff: { id: 5, name: "Ada", monthly_salary: 50000 }, month: "2026-09", office, teamwork_rating: 8, overrides: {}, priorScores: [],
    tasks: [task({ status: "VERIFIED", submitted_date: "2026-09-09", performance_score: 100 }), task({ status: "VERIFIED", submitted_date: "2026-09-12" })],
    attendance: [{ date: "2026-09-01", event_type: "WORK", status: "PRESENT" }, { date: "2026-09-02", event_type: "WORK", status: "PRESENT" }],
    reports: E.weeksOfMonth("2026-09").map((w) => ({ week_start: w, status: "APPROVED", on_time: true })),
    deliverables: [{ expected_date: "2026-09-10", status: "APPROVED", quality_rating: 9, submitted_date: "2026-09-10" }],
    kpis: [kpi(1, {}), kpi(2, { measurement_type: "DEADLINE", target: 90, auto_source: "TASK_ON_TIME" })], kpiResults: [{ kpi_id: 1, month: "2026-09", rating: 8 }],
    ...over,
  };
}

test("calculate: components weighted, points add up to the final score, payment recommendation", () => {
  const c = E.calculate(sample(), {}, TODAY);
  const pts = c.components.reduce((a, x) => a + (x.points || 0), 0); approx(pts, c.final_score, 0.02);
  const task_ = c.components.find((x) => x.component === "task"); approx(task_.raw_score, 0.875, 1e-9);
  assert.equal(c.components.length, 6);
  assert.equal(c.base_salary, 50000);
  assert.ok(c.final_score > 70 && c.final_score <= 100);
  assert.equal(c.recommended_payment, 50000);
  assert.equal(c.incomplete, false);
});

test("calculate: missing components are excluded (EXCLUDE) or zeroed (ZERO) and flagged incomplete", () => {
  const d = sample({ tasks: [], teamwork_rating: null });
  const ex = E.calculate(d, {}, TODAY); assert.equal(ex.incomplete, true); assert.ok(ex.data_quality.missing_components.includes("task"));
  const zero = E.calculate(d, { missing_component_policy: "ZERO" }, TODAY); assert.ok(zero.final_score < ex.final_score);
  const none = E.calculate(sample({ tasks: [], attendance: [], reports: [], deliverables: [], kpis: [], kpiResults: [], teamwork_rating: null }), {}, TODAY);
  assert.equal(none.final_score, 0);
});

test("calculate: an override replaces a component and is flagged", () => {
  const base = E.calculate(sample(), {}, TODAY);
  const ov = E.calculate(sample({ overrides: { task: 0 } }), {}, TODAY);
  assert.ok(ov.final_score < base.final_score); assert.equal(ov.components[0].overridden, true);
});

test("calculate: weights are configurable", () => {
  const c = E.calculate(sample(), { weights: { task: 100, kpi: 0, attendance: 0, reports: 0, productivity: 0, teamwork: 0 } }, TODAY);
  approx(c.final_score, 87.5, 0.01);
});

test("exit review: below 30 two months in a row flags review; never auto-terminates", () => {
  const bad = { tasks: [task({ status: "TODO" })], attendance: [{ date: "2026-09-01", event_type: "WORK", status: "ABSENT" }], reports: [], deliverables: [], kpis: [], teamwork_rating: 1 };
  const one = E.calculate(sample({ ...bad, priorScores: [] }), {}, TODAY); assert.ok(one.final_score < 30); assert.equal(one.exit_review_required, false);
  const two = E.calculate(sample({ ...bad, priorScores: [20] }), {}, TODAY); assert.equal(two.exit_review_required, true); assert.equal(two.exit_review_label, "EXIT / MANAGEMENT REVIEW REQUIRED");
  const rec = E.calculate(sample({ ...bad, priorScores: [55] }), {}, TODAY); assert.equal(rec.exit_review_required, false);
  assert.equal(two.recommended_payment, 0);
});

test("alerts", () => {
  const d = sample({ tasks: [task({ status: "TODO", title: "Late job", assignment_id: 9 })], attendance: [1, 2, 3, 4].map((i) => ({ date: `2026-09-0${i}`, event_type: "WORK", status: "LATE" })), reports: [] });
  const calc = E.calculate(d, {}, TODAY);
  const kinds = E.computeAlerts({ staff: d.staff, month: "2026-09", calc, data: d }, {}, TODAY).map((a) => a.kind);
  for (const k of ["TASK_OVERDUE", "REPORT_MISSING", "REPEATED_LATENESS"]) assert.ok(kinds.includes(k), k);
});

test("defaults: seven offices from the manual with responsibilities and KPIs", () => {
  assert.equal(OFFICES.length, 7);
  assert.deepEqual(OFFICES.map((o) => o.responsibilities.length), [11, 11, 11, 11, 15, 15, 20]);
  assert.deepEqual(OFFICES.map((o) => o.kpis.length), [9, 9, 9, 9, 10, 10, 12]);
  assert.equal(DEFAULT_SETTINGS.weights.task + DEFAULT_SETTINGS.weights.kpi + DEFAULT_SETTINGS.weights.attendance + DEFAULT_SETTINGS.weights.reports + DEFAULT_SETTINGS.weights.productivity + DEFAULT_SETTINGS.weights.teamwork, 100);
});
