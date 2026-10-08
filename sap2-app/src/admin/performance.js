"use strict";
// Business logic for administrative performance. All scoring happens here/in engine.js (server side only).
const crypto = require("crypto");
const E = require("./engine");
const { DEFAULT_SETTINGS } = require("./defaults");

class HttpError extends Error { constructor(status, message, extra) { super(message); this.status = status; this.extra = extra; } }
const bad = (m, x) => new HttpError(400, m, x);
const conflict = (m, x) => new HttpError(409, m, x);
const forbid = (m = "Not allowed for your role") => new HttpError(403, m);
const notFound = (m = "Not found") => new HttpError(404, m);

const todayStr = () => new Date(Date.now() + Number(process.env.SAP2_TZ_OFFSET_HOURS ?? 1) * 3600e3).toISOString().slice(0, 10);
const isAdminType = (s) => s && (s.staff_type === "admin" || s.staff_type === "both");
const now = () => new Date().toISOString();

// ---------------- settings ----------------
async function getSettings(store) {
  const obj = {}; for (const r of await store.find("performance_settings")) obj[r.key] = r.value;
  return E.mergeSettings(obj);
}
function validateSettings(p) {
  const n = (v) => typeof v === "number" && Number.isFinite(v) && v >= 0;
  for (const k of Object.keys(p)) if (!(k in DEFAULT_SETTINGS)) return `Unknown setting "${k}"`;
  if (p.weights) {
    for (const c of E.COMPONENTS) if (!n(p.weights[c] ?? 0)) return `Weight for ${c} must be a number >= 0`;
    const sum = E.COMPONENTS.reduce((a, c) => a + (p.weights[c] ?? 0), 0);
    if (Math.abs(sum - 100) > 0.01) return `Weights must add up to 100 (they add up to ${sum})`;
  }
  if (p.bands) {
    if (!Array.isArray(p.bands) || !p.bands.length) return "bands must be a non-empty list";
    const mins = p.bands.map((b) => b.min);
    if (!p.bands.every((b) => b.key && n(b.min) && b.min <= 100 && n(b.pay_pct) && b.pay_pct <= 100)) return "Each band needs key, min (0-100) and pay_pct (0-100)";
    if (!mins.includes(0)) return "One band must start at 0";
    if (new Set(mins).size !== mins.length) return "Band minimums must be different";
  }
  for (const k of ["exit_review_below", "exit_review_consecutive", "kpi_weight_cap_pct", "grace_minutes", "late_task_penalty_pct", "late_deliverable_penalty_pct", "late_report_credit_pct", "report_grace_days", "attendance_alert_below_pct", "repeated_lateness_count", "unverified_alert_count", "kpi_missed_below_pct"])
    if (k in p && !n(p[k])) return `${k} must be a number >= 0`;
  if (p.kpi_weight_cap_pct !== undefined && (p.kpi_weight_cap_pct < 1 || p.kpi_weight_cap_pct > 100)) return "kpi_weight_cap_pct must be 1-100";
  if (p.attendance_split) for (const k of ["daily", "meeting", "punctuality"]) if (!n(p.attendance_split[k] ?? 0)) return `attendance_split.${k} must be a number >= 0`;
  if (p.priority_weights) for (const k of ["LOW", "MEDIUM", "HIGH"]) if (!n(p.priority_weights[k] ?? 0)) return `priority_weights.${k} must be a number >= 0`;
  if (p.missing_component_policy && !["EXCLUDE", "ZERO"].includes(p.missing_component_policy)) return "missing_component_policy must be EXCLUDE or ZERO";
  if (p.attendance_enabled !== undefined && typeof p.attendance_enabled !== "boolean") return "attendance_enabled must be true or false";
  if (p.enforce_payroll_approval !== undefined && typeof p.enforce_payroll_approval !== "boolean") return "enforce_payroll_approval must be true or false";
  return null;
}
async function saveSettings(store, patch, actor, reason) {
  const err = validateSettings(patch); if (err) throw bad(err);
  return store.tx(async (tx) => {
    const old = await getSettings(tx);
    for (const [k, v] of Object.entries(patch)) await tx.upsert("performance_settings", { key: k, value: v, updated_by: actor.name, updated_at: now() }, ["key"]);
    const neu = await getSettings(tx);
    await audit(tx, actor, { action: "SETTINGS_CHANGED", entity: "performance_settings", old: pick(old, Object.keys(patch)), new: pick(neu, Object.keys(patch)), reason });
    return neu;
  });
}
const pick = (o, ks) => Object.fromEntries(ks.map((k) => [k, o[k]]));

// ---------------- audit ----------------
function audit(store, actor, o) {
  return store.insert("performance_audit_logs", {
    actor: actor ? actor.name : "system", action: o.action, entity: o.entity || null, entity_id: o.entity_id != null ? String(o.entity_id) : null,
    staff_id: o.staff_id || null, month: o.month || null, old_value: o.old === undefined ? null : o.old, new_value: o.new === undefined ? null : o.new, reason: o.reason || null,
  });
}

// ---------------- month / review guards ----------------
async function monthStatus(store, month) { const r = await store.one("performance_months", { month }); return r ? r.status : "OPEN"; }
async function assertMonthOpen(store, month, what = "this data") {
  if ((await monthStatus(store, month)) === "CLOSED") throw conflict(`${month} is closed. Reopen the month (with a reason) before changing ${what}.`);
}
// Scoring inputs may only change while the staff member's review for that month is still a draft.
async function assertEditable(store, staffId, month, what = "this data") {
  await assertMonthOpen(store, month, what);
  const rv = await store.one("performance_reviews", { staff_id: staffId, month });
  if (rv && rv.status !== "DRAFT") throw conflict(`Performance for ${month} is already ${rv.status.toLowerCase()} for this staff member. Reopen the review first (with a reason) before changing ${what}.`);
}

// ---------------- load + calculate ----------------
async function adminStaff(store, includeInactive = false) {
  const w = { staff_type: ["admin", "both"] }; if (!includeInactive) w.active = true;
  return store.find("staff", w, { order: [["name", "asc"]] });
}
async function loadData(store, staff, month) {
  const { from, to } = E.monthRange(month);
  const office = staff.office_id ? await store.one("administrative_offices", { id: staff.office_id }) : null;
  const asg = await store.find("task_assignments", { staff_id: staff.id });
  const tasks = asg.length ? await store.find("admin_tasks", { id: [...new Set(asg.map((a) => a.task_id))] }) : [];
  const tmap = new Map(tasks.map((t) => [t.id, t]));
  const taskRows = asg.filter((a) => tmap.has(a.task_id)).map((a) => { const t = tmap.get(a.task_id); return { assignment_id: a.id, task_id: t.id, title: t.title, priority: t.priority, due_date: t.due_date, cancelled: t.cancelled, status: a.status, verification_status: a.verification_status, submitted_date: a.submitted_date, performance_score: a.performance_score }; });
  const kpis = office ? await store.find("office_kpis", { office_id: office.id }) : [];
  const input = await store.one("performance_inputs", { staff_id: staff.id, month });
  const ov = {}; for (const o of await store.find("performance_overrides", { staff_id: staff.id, month })) ov[o.component] = Number(o.value);
  const settings = await getSettings(store);
  const prior = []; let pm = month;
  for (let i = 1; i < settings.exit_review_consecutive; i++) { pm = E.prevMonth(pm); const r = await store.one("performance_reviews", { staff_id: staff.id, month: pm }); prior.push(r ? Number(r.final_score) : null); }
  return {
    staff, month, office, tasks: taskRows, kpis, kpiResults: await store.find("kpi_results", { staff_id: staff.id, month: E.quarterMonths(month) }),
    attendance: await store.find("admin_attendance", { staff_id: staff.id, date: { gte: from, lt: to } }),
    reports: await store.find("weekly_reports", { staff_id: staff.id, week_start: { gte: from, lt: to } }),
    deliverables: await store.find("deliverables", { staff_id: staff.id, expected_date: { gte: from, lt: to } }),
    teamwork_rating: input && input.teamwork_rating !== null ? Number(input.teamwork_rating) : null, teamwork_comment: input ? input.teamwork_comment : null, overrides: ov, priorScores: prior, settings,
  };
}
async function calcLive(store, staff, month, today = todayStr()) {
  const data = await loadData(store, staff, month);
  return { calc: E.calculate(data, data.settings, today), data };
}

const num = E.num;
function shapeFromReview(rv, comps, staff, settings) {
  const components = E.COMPONENTS.map((c) => {
    const r = comps.find((x) => x.component === c) || {};
    return { component: c, label: E.COMPONENT_LABELS[c], weight: num(r.weight), effective_weight: num(r.effective_weight), raw_score: r.raw_score === null || r.raw_score === undefined ? null : Number(r.raw_score), score_pct: r.raw_score === null || r.raw_score === undefined ? null : E.r2(Number(r.raw_score) * 100), points: r.points === null || r.points === undefined ? null : Number(r.points), overridden: !!r.overridden, system_score: r.details && r.details._system !== undefined ? r.details._system : null, details: r.details || {} };
  });
  const pay = E.paymentFor(num(rv.base_salary), num(rv.final_score), settings);
  return { staff_id: rv.staff_id, month: rv.month, office_id: rv.office_id, final_score: num(rv.final_score), ...pay, components, incomplete: rv.incomplete, data_quality: rv.data_quality || {}, exit_review_required: rv.exit_review_required, exit_review_label: rv.exit_review_required ? "EXIT / MANAGEMENT REVIEW REQUIRED" : null };
}

async function storeReview(tx, staff, calc, actor) {
  const existing = await tx.one("performance_reviews", { staff_id: staff.id, month: calc.month });
  const row = {
    staff_id: staff.id, month: calc.month, office_id: calc.office_id, base_salary: calc.base_salary, final_score: calc.final_score, band: calc.performance_band,
    payment_percentage: calc.payment_percentage, payment_status: calc.payment_status, recommended_pay: calc.recommended_payment, incomplete: calc.incomplete,
    data_quality: calc.data_quality, exit_review_required: calc.exit_review_required, calculated_at: now(),
  };
  const rv = await tx.upsert("performance_reviews", row, ["staff_id", "month"]);
  await tx.remove("performance_components", { review_id: rv.id });
  for (const c of calc.components) {
    await tx.insert("performance_components", { review_id: rv.id, component: c.component, weight: c.weight, effective_weight: c.effective_weight, raw_score: c.raw_score, points: c.points, overridden: c.overridden, details: { ...c.details, _system: c.system_score } });
  }
  if (existing && Math.abs(num(existing.final_score) - calc.final_score) > 0.004)
    await audit(tx, actor, { action: "PERFORMANCE_RECALCULATED", entity: "performance_review", entity_id: rv.id, staff_id: staff.id, month: calc.month, old: { final_score: num(existing.final_score) }, new: { final_score: calc.final_score } });
  return rv;
}

async function calculateAndStore(store, staffId, month, actor, today = todayStr()) {
  return store.tx(async (tx) => {
    const staff = await tx.one("staff", { id: staffId }); if (!staff) throw notFound("Staff not found");
    if (!isAdminType(staff)) throw bad("Performance applies to administrative staff only");
    await assertMonthOpen(tx, month, "performance");
    const ex = await tx.one("performance_reviews", { staff_id: staffId, month });
    if (ex && ex.status !== "DRAFT") throw conflict(`Review is ${ex.status.toLowerCase()}. Reopen it (with a reason) to recalculate.`);
    const { calc } = await calcLive(tx, staff, month, today);
    const rv = await storeReview(tx, staff, calc, actor);
    return { review: rv, calc };
  });
}

async function finalizeReview(store, staffId, month, actor, { acknowledge_incomplete = false } = {}, today = todayStr()) {
  return store.tx(async (tx) => {
    const staff = await tx.one("staff", { id: staffId }); if (!staff || !isAdminType(staff)) throw notFound("Administrative staff member not found");
    await assertMonthOpen(tx, month, "performance");
    let rv = await tx.one("performance_reviews", { staff_id: staffId, month });
    if (rv && rv.status !== "DRAFT") throw conflict(`Review is already ${rv.status.toLowerCase()}.`);
    const { calc } = await calcLive(tx, staff, month, today); // always finalize from fresh numbers
    if (calc.incomplete && !acknowledge_incomplete) throw conflict("Data for this month is incomplete. Review the warnings, then confirm to finalize anyway.", { warnings: calc.data_quality.warnings, needs_acknowledgement: true });
    rv = await storeReview(tx, staff, calc, actor);
    rv = (await tx.update("performance_reviews", { id: rv.id }, { status: "FINALIZED", finalized_by: actor.name, finalized_at: now() }))[0];
    await snapshot(tx, rv, calc, actor);
    await audit(tx, actor, { action: "PERFORMANCE_FINALIZED", entity: "performance_review", entity_id: rv.id, staff_id: staffId, month, new: { final_score: calc.final_score, recommended_pay: calc.recommended_payment, incomplete: calc.incomplete }, reason: calc.incomplete ? "Finalized with incomplete data (acknowledged)" : null });
    return { review: rv, calc };
  });
}

async function snapshot(tx, rv, calc, actor) {
  const prev = await tx.find("performance_history", { staff_id: rv.staff_id, month: rv.month }, { order: [["version", "desc"]], limit: 1 });
  const sc = (c) => { const x = calc.components.find((y) => y.component === c); return x && x.score_pct !== null ? x.score_pct : null; };
  const paid = await tx.one("payments", { staff_id: rv.staff_id, month: rv.month, pay_type: "admin" });
  return tx.insert("performance_history", {
    staff_id: rv.staff_id, month: rv.month, version: prev.length ? prev[0].version + 1 : 1, office_id: rv.office_id, task_score: sc("task"), kpi_score: sc("kpi"), attendance_score: sc("attendance"),
    report_score: sc("reports"), productivity_score: sc("productivity"), teamwork_score: sc("teamwork"), final_score: rv.final_score, band: rv.band, salary: rv.base_salary,
    recommended_pay: rv.recommended_pay, approved_pay: rv.approved_pay, payment_status: paid ? "PAID" : rv.approved_pay !== null && rv.approved_pay !== undefined ? "APPROVED" : "NOT_APPROVED",
    snapshot: { review: { ...rv }, calc }, created_by: actor ? actor.name : "system",
  });
}

async function reopenReview(store, staffId, month, actor, reason) {
  if (!reason || !String(reason).trim()) throw bad("A reason is required to reopen a review");
  return store.tx(async (tx) => {
    const rv = await tx.one("performance_reviews", { staff_id: staffId, month }); if (!rv) throw notFound("No review for that month");
    if (rv.status === "CLOSED") throw conflict("The month is closed. Reopen the month first.");
    if (rv.status === "DRAFT") throw conflict("Review is already a draft.");
    if (await tx.one("payments", { staff_id: staffId, month, pay_type: "admin" })) throw conflict("Salary for this month is already paid; the review can no longer be reopened.");
    const [u] = await tx.update("performance_reviews", { id: rv.id }, { status: "DRAFT", approved_pay: null, approved_by: null, approved_at: null, approval_reason: null, finalized_by: null, finalized_at: null });
    await audit(tx, actor, { action: "PERFORMANCE_REOPENED", entity: "performance_review", entity_id: rv.id, staff_id: staffId, month, old: { status: rv.status, approved_pay: rv.approved_pay }, new: { status: "DRAFT" }, reason });
    return u;
  });
}

// ---------------- inputs set by management ----------------
async function setOverride(store, staffId, month, component, value, reason, actor) {
  if (!E.COMPONENTS.includes(component)) throw bad("Unknown component");
  if (!reason || !String(reason).trim()) throw bad("A reason is required for a score adjustment");
  return store.tx(async (tx) => {
    const staff = await tx.one("staff", { id: staffId }); if (!staff || !isAdminType(staff)) throw notFound("Administrative staff member not found");
    await assertEditable(tx, staffId, month, "scores");
    const old = await tx.one("performance_overrides", { staff_id: staffId, month, component });
    if (value === null || value === undefined) { await tx.remove("performance_overrides", { staff_id: staffId, month, component }); }
    else {
      const v = Number(value); if (!Number.isFinite(v) || v < 0 || v > 100) throw bad("Adjusted value must be between 0 and 100");
      await tx.upsert("performance_overrides", { staff_id: staffId, month, component, value: v, reason, set_by: actor.name, set_at: now() }, ["staff_id", "month", "component"]);
    }
    await audit(tx, actor, { action: "SCORE_ADJUSTED", entity: "performance_override", entity_id: component, staff_id: staffId, month, old: old ? { value: Number(old.value) } : null, new: value === null || value === undefined ? null : { value: Number(value) }, reason });
    return { ok: true };
  });
}
async function setTeamwork(store, staffId, month, rating, comment, reason, actor) {
  const r = Number(rating); if (rating === null || rating === undefined || !Number.isFinite(r) || r < 0 || r > 10) throw bad("rating must be a number from 0 to 10");
  return store.tx(async (tx) => {
    const staff = await tx.one("staff", { id: staffId }); if (!staff || !isAdminType(staff)) throw notFound("Administrative staff member not found");
    await assertEditable(tx, staffId, month, "the teamwork rating");
    const old = await tx.one("performance_inputs", { staff_id: staffId, month });
    if (old && old.teamwork_rating !== null && Number(old.teamwork_rating) !== r && !(reason && String(reason).trim())) throw bad("A reason is required to change an existing rating");
    const row = await tx.upsert("performance_inputs", { staff_id: staffId, month, teamwork_rating: r, teamwork_comment: comment || null, set_by: actor.name, updated_at: now() }, ["staff_id", "month"]);
    await audit(tx, actor, { action: "TEAMWORK_RATING_SET", entity: "performance_input", entity_id: row.id, staff_id: staffId, month, old: old ? { rating: old.teamwork_rating === null ? null : Number(old.teamwork_rating) } : null, new: { rating: r }, reason });
    return row;
  });
}

// ---------------- scoreboard / profile ----------------
async function reviewView(store, staff, month, settings, today) {
  const rv = await store.one("performance_reviews", { staff_id: staff.id, month });
  if (rv && rv.status !== "DRAFT") {
    const comps = await store.find("performance_components", { review_id: rv.id });
    return { review: rv, calc: shapeFromReview(rv, comps, staff, settings), live: false };
  }
  const { calc } = await calcLive(store, staff, month, today);
  return { review: rv, calc, live: true };
}
function payrollInfo(rv, calc, paid) {
  return {
    base_salary: calc.base_salary, performance_score: calc.final_score, recommended_pay: rv && rv.status !== "DRAFT" ? rv.recommended_pay : calc.recommended_payment,
    approved_pay: rv && rv.approved_pay !== null && rv.approved_pay !== undefined ? rv.approved_pay : null, actual_paid: paid ? paid.amount : null,
    perf_status: paid ? "PAID" : !rv ? "NOT_CALCULATED" : rv.status === "DRAFT" ? "DRAFT" : rv.approved_pay !== null && rv.approved_pay !== undefined ? "APPROVED" : "FINALIZED",
  };
}
async function scoreboard(store, month, today = todayStr(), { office_id = null } = {}) {
  const settings = await getSettings(store);
  const staffList = (await adminStaff(store)).filter((s) => !office_id || s.office_id === Number(office_id));
  const offices = new Map((await store.find("administrative_offices")).map((o) => [o.id, o]));
  const rows = [];
  for (const s of staffList) {
    const { review, calc, live } = await reviewView(store, s, month, settings, today);
    const paid = await store.one("payments", { staff_id: s.id, month, pay_type: "admin" });
    const sc = (c) => calc.components.find((x) => x.component === c).score_pct;
    rows.push({
      staff_id: s.id, name: s.name, role: s.role, staff_type: s.staff_type, office_id: s.office_id, office: s.office_id ? (offices.get(s.office_id) || {}).name : null,
      salary: s.monthly_salary || 0, task: sc("task"), kpi: sc("kpi"), attendance: sc("attendance"), reports: sc("reports"), productivity: sc("productivity"), teamwork: sc("teamwork"),
      final_score: calc.final_score, band: calc.performance_band, band_label: calc.band_label, payment_percentage: calc.payment_percentage, payment_status: calc.payment_status,
      recommended_pay: calc.recommended_payment, state: live ? (review ? "DRAFT" : "LIVE") : review.status, incomplete: calc.incomplete, exit_review_required: calc.exit_review_required,
      exit_review_label: calc.exit_review_label, has_data: calc.components.some((c) => c.raw_score !== null), payroll: payrollInfo(review, calc, paid), details: calc,
    });
  }
  rows.sort((a, b) => b.final_score - a.final_score);
  rows.forEach((r, i) => (r.rank = i + 1));
  return { month, month_status: await monthStatus(store, month), settings, rows };
}

async function trend(store, staffId, month, n = 6) {
  const months = []; let m = month; for (let i = 0; i < n; i++) { months.unshift(m); m = E.prevMonth(m); }
  const out = [];
  for (const mm of months) {
    const h = await store.find("performance_history", { staff_id: staffId, month: mm }, { order: [["version", "desc"]], limit: 1 });
    const rv = h.length ? null : await store.one("performance_reviews", { staff_id: staffId, month: mm });
    out.push({ month: mm, score: h.length ? Number(h[0].final_score) : rv ? Number(rv.final_score) : null, source: h.length ? "history" : rv ? "review" : null });
  }
  return out;
}

async function staffPerformance(store, staffId, month, today = todayStr(), { forStaff = false } = {}) {
  const staff = await store.one("staff", { id: staffId }); if (!staff) throw notFound("Staff not found");
  if (!isAdminType(staff)) throw bad("Performance applies to administrative staff only");
  const settings = await getSettings(store);
  const { review, calc, live } = await reviewView(store, staff, month, settings, today);
  const paid = await store.one("payments", { staff_id: staffId, month, pay_type: "admin" });
  const office = staff.office_id ? await store.one("administrative_offices", { id: staff.office_id }) : null;
  const responsibilities = office ? await store.find("office_responsibilities", { office_id: office.id, active: true }, { order: [["position", "asc"]] }) : [];
  const comments = await store.find("performance_comments", { staff_id: staffId }, { order: [["created_at", "desc"]], limit: 50 });
  const history = await store.find("performance_history", { staff_id: staffId }, { order: [["month", "desc"], ["version", "desc"]], limit: 24 });
  const out = {
    staff: { id: staff.id, name: staff.name, role: staff.role, staff_type: staff.staff_type, office_id: staff.office_id, office: office ? office.name : null, monthly_salary: staff.monthly_salary || 0, active: staff.active },
    month, state: live ? (review ? "DRAFT" : "LIVE") : review.status, calc, payroll: payrollInfo(review, calc, paid), trend: await trend(store, staffId, month),
    responsibilities: responsibilities.map((r) => r.text), comments: forStaff ? comments.filter((c) => c.kind !== "DECISION") : comments,
    history: history.map(({ snapshot: _s, ...h }) => h), month_status: await monthStatus(store, month),
  };
  if (!forStaff) out.audit = await store.find("performance_audit_logs", { staff_id: staffId }, { order: [["created_at", "desc"], ["id", "desc"]], limit: 30 });
  return out;
}

// ---------------- alerts ----------------
async function syncAlerts(store, month, today = todayStr()) {
  if ((await monthStatus(store, month)) === "CLOSED") return;
  const settings = await getSettings(store);
  const wanted = [];
  for (const s of await adminStaff(store)) {
    const { calc, data } = await calcLive(store, s, month, today);
    wanted.push(...E.computeAlerts({ staff: s, month, calc, data }, settings, today));
  }
  const existing = await store.find("performance_alerts", { month });
  const key = (a) => `${a.staff_id}|${a.kind}|${a.ref || ""}`;
  const seen = new Set();
  for (const a of wanted) {
    seen.add(key(a)); const ex = existing.find((e) => key(e) === key(a));
    if (ex) await store.update("performance_alerts", { id: ex.id }, { message: a.message, severity: a.severity, office_id: a.office_id, resolved: false, resolved_by: null, resolved_at: null, last_seen_at: now() });
    else await store.insert("performance_alerts", { ...a, ref: a.ref || "", last_seen_at: now() });
  }
  for (const e of existing) if (!seen.has(key(e)) && !e.resolved) await store.update("performance_alerts", { id: e.id }, { resolved: true, resolved_by: "system", resolved_at: now() });
}

// ---------------- month closing ----------------
async function closingReport(store, month, today = todayStr()) {
  const settings = await getSettings(store);
  const per = [];
  for (const s of await adminStaff(store)) { const v = await reviewView(store, s, month, settings, today); per.push({ staff: s, calc: v.live ? v.calc : v.calc, review: v.review }); }
  const checks = E.closingChecks(per);
  return { month, status: await monthStatus(store, month), checks, blockers: checks.filter((c) => c.severity === "BLOCK").length, warnings: checks.filter((c) => c.severity === "WARN").length, staff_count: per.length };
}
async function closeMonth(store, month, actor, { acknowledge_incomplete = false, notes = null } = {}, today = todayStr()) {
  const rep = await closingReport(store, month, today);
  if (rep.status === "CLOSED") throw conflict(`${month} is already closed.`);
  if (rep.blockers) throw conflict("Some staff reviews are not ready. Finalize them (or assign an office) before closing the month.", { checks: rep.checks, blockers: rep.blockers });
  if (rep.warnings && !acknowledge_incomplete) throw conflict("Data for this month is incomplete. Review the warnings, then confirm to close anyway.", { checks: rep.checks, needs_acknowledgement: true });
  return store.tx(async (tx) => {
    const settings = await getSettings(tx);
    const reviews = await tx.find("performance_reviews", { month, status: "FINALIZED" });
    for (const rv of reviews) {
      const [u] = await tx.update("performance_reviews", { id: rv.id }, { status: "CLOSED" });
      const comps = await tx.find("performance_components", { review_id: rv.id });
      const staff = await tx.one("staff", { id: rv.staff_id });
      await snapshot(tx, u, shapeFromReview(u, comps, staff, settings), actor);
    }
    await tx.upsert("performance_months", { month, status: "CLOSED", closed_by: actor.name, closed_at: now(), close_notes: { notes, warnings: rep.checks } }, ["month"]);
    await audit(tx, actor, { action: "PERFORMANCE_MONTH_CLOSED", entity: "performance_month", entity_id: month, month, new: { reviews: reviews.length, warnings: rep.warnings }, reason: notes });
    return { month, closed: true, reviews: reviews.length };
  });
}
async function reopenMonth(store, month, actor, reason) {
  if (!reason || !String(reason).trim()) throw bad("A reason is required to reopen a closed month");
  return store.tx(async (tx) => {
    const m = await tx.one("performance_months", { month }); if (!m || m.status !== "CLOSED") throw conflict(`${month} is not closed.`);
    await tx.update("performance_months", { month }, { status: "OPEN", reopened_by: actor.name, reopened_at: now(), reopen_reason: reason });
    const closed = await tx.find("performance_reviews", { month, status: "CLOSED" });
    for (const rv of closed) await tx.update("performance_reviews", { id: rv.id }, { status: "FINALIZED" });
    await audit(tx, actor, { action: "PERFORMANCE_MONTH_REOPENED", entity: "performance_month", entity_id: month, month, new: { reviews_reopened: closed.length }, reason });
    return { month, reopened: true, reviews: closed.length };
  });
}

// ---------------- payroll approval ----------------
async function approvePayroll(store, month, items, actor) {
  if (!Array.isArray(items) || !items.length) throw bad("items must be a non-empty list");
  return store.tx(async (tx) => {
    const out = [];
    for (const it of items) {
      const sid = Number(it.staff_id);
      const staff = await tx.one("staff", { id: sid }); if (!staff || !isAdminType(staff)) throw notFound(`Administrative staff ${it.staff_id} not found`);
      const rv = await tx.one("performance_reviews", { staff_id: sid, month });
      if (!rv || rv.status === "DRAFT") throw conflict(`${staff.name}: finalize the ${month} performance review before approving pay.`);
      if (await tx.one("payments", { staff_id: sid, month, pay_type: "admin" })) throw conflict(`${staff.name}: already paid for ${month}.`);
      const rec = rv.recommended_pay;
      const approved = it.approved_pay === undefined || it.approved_pay === null ? rec : Math.round(Number(it.approved_pay));
      if (!Number.isFinite(approved) || approved < 0) throw bad(`${staff.name}: approved pay must be a number >= 0`);
      if (approved > rv.base_salary) throw bad(`${staff.name}: approved pay cannot exceed the base salary (${rv.base_salary}).`);
      if (approved !== rec && !(it.reason && String(it.reason).trim())) throw bad(`${staff.name}: a reason is required when approved pay differs from the recommendation (${rec}).`);
      const [u] = await tx.update("performance_reviews", { id: rv.id }, { approved_pay: approved, approved_by: actor.name, approved_at: now(), approval_reason: it.reason || null });
      await audit(tx, actor, { action: "PAYROLL_APPROVED", entity: "performance_review", entity_id: rv.id, staff_id: sid, month, old: { approved_pay: rv.approved_pay }, new: { approved_pay: approved, recommended_pay: rec, base_salary: rv.base_salary }, reason: it.reason });
      out.push({ staff_id: sid, name: staff.name, recommended_pay: rec, approved_pay: u.approved_pay });
    }
    return out;
  });
}

// ---------------- staff access codes (staff portal) ----------------
const normCode = (c) => String(c == null ? "" : c).replace(/[^A-Za-z0-9]/g, "").toUpperCase();
const hashCode = (code, salt) => crypto.scryptSync(normCode(code), salt, 32).toString("hex");
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I so codes are easy to read out
const randomChars = (n) => Array.from(crypto.randomBytes(n), (b) => ALPHABET[b % ALPHABET.length]).join("");
const newCode = () => randomChars(8);
const group = (s, k) => s.match(new RegExp(`.{1,${k}}`, "g")).join("-");
const sameHash = (code, row) => { const a = Buffer.from(hashCode(code, row.code_salt)), b = Buffer.from(row.code_hash); return a.length === b.length && crypto.timingSafeEqual(a, b); };
async function createAccessCode(store, staffId, actor) {
  const staff = await store.one("staff", { id: staffId }); if (!staff || !isAdminType(staff)) throw notFound("Administrative staff member not found");
  const code = newCode(), salt = crypto.randomBytes(16).toString("hex");
  await store.upsert("staff_access", { staff_id: staffId, code_salt: salt, code_hash: hashCode(code, salt), created_by: actor.name, created_at: now(), last_used_at: null }, ["staff_id"]);
  await audit(store, actor, { action: "STAFF_ACCESS_CODE_CREATED", entity: "staff_access", entity_id: staffId, staff_id: staffId });
  return code;
}
async function verifyAccessCode(store, staffId, code) {
  const row = await store.one("staff_access", { staff_id: Number(staffId) }); if (!row || !code) return null;
  if (!sameHash(code, row)) return null;
  const staff = await store.one("staff", { id: Number(staffId) }); return staff && staff.active && isAdminType(staff) ? staff : null;
}

// ---------------- login page codes: administrator + one per office ----------------
const PREFIX = { PERSONAL_ASSISTANT: "PA" };
const OFFICE_KEY = (office) => "OFFICE:" + office.code;
async function storeCode(store, key, scope, office, code, actor) {
  const salt = crypto.randomBytes(16).toString("hex");
  await store.upsert("access_codes", { key, scope, office_id: office ? office.id : null, code_salt: salt, code_hash: hashCode(code, salt), created_by: actor ? actor.name : "system", created_at: now(), last_used_at: null }, ["key"]);
}
/** New private code for one office (office prefix + 10 random characters). The previous code stops working at once. */
async function createOfficeCode(store, officeId, actor, prefix) {
  const office = await store.one("administrative_offices", { id: Number(officeId) }); if (!office) throw notFound("Office not found");
  const code = `${prefix || PREFIX[office.code] || office.code.split("_")[0].slice(0, 8)}-${group(randomChars(10), 5)}`;
  await storeCode(store, OFFICE_KEY(office), "OFFICE", office, code, actor);
  await audit(store, actor, { action: "OFFICE_ACCESS_CODE_CREATED", entity: "access_code", entity_id: office.id, new: { office: office.name } });
  return code;
}
/** New private administrator code (shown once). The previous administrator code stops working at once. */
async function createAdminCode(store, actor) {
  const code = `ADMIN-${group(randomChars(12), 4)}`;
  await storeCode(store, "ADMIN", "ADMIN", null, code, actor);
  await audit(store, actor, { action: "ADMIN_ACCESS_CODE_CREATED", entity: "access_code", entity_id: "ADMIN" });
  return code;
}
const touch = (store, key) => store.update("access_codes", { key }, { last_used_at: now() }).catch(() => {});
async function verifyAdminCode(store, code) {
  if (!normCode(code)) return false;
  const row = await store.one("access_codes", { key: "ADMIN" }); if (!row || !sameHash(code, row)) return false;
  touch(store, "ADMIN"); return true;
}
/** Returns the office when the code is right for that office, else null. */
async function verifyOfficeLogin(store, officeId, code) {
  if (!normCode(code)) return null;
  const office = await store.one("administrative_offices", { id: Number(officeId) }); if (!office || !office.active) return null;
  const row = await store.one("access_codes", { key: OFFICE_KEY(office) }); if (!row || !sameHash(code, row)) return null;
  touch(store, row.key); return office;
}
/** Staff member signing in with their office's code: must be an active administrative member of that office. */
async function verifyOfficeCode(store, staffId, code) {
  const staff = await store.one("staff", { id: Number(staffId) }); if (!staff || !staff.active || !isAdminType(staff) || !staff.office_id) return null;
  return (await verifyOfficeLogin(store, staff.office_id, code)) ? staff : null;
}
async function officeMembers(store, officeId) {
  return (await store.find("staff", { office_id: Number(officeId), active: true }, { order: [["name", "asc"]] })).filter(isAdminType).map((s) => ({ id: s.id, name: s.name, role: s.role }));
}
async function accessOverview(store) {
  const rows = await store.find("access_codes"); const offices = await store.find("administrative_offices", {}, { order: [["sort_order", "asc"]] });
  const by = new Map(rows.map((r) => [r.key, r])); const shape = (r) => (r ? { set: true, created_at: r.created_at, created_by: r.created_by, last_used_at: r.last_used_at } : { set: false });
  return { admin: shape(by.get("ADMIN")), offices: offices.map((o) => ({ office_id: o.id, office: o.name, ...shape(by.get(OFFICE_KEY(o))) })) };
}

module.exports = {
  HttpError, bad, conflict, forbid, notFound, todayStr, isAdminType, getSettings, saveSettings, validateSettings, audit, monthStatus, assertMonthOpen, assertEditable,
  adminStaff, loadData, calcLive, calculateAndStore, finalizeReview, reopenReview, setOverride, setTeamwork, scoreboard, staffPerformance, trend, reviewView, payrollInfo,
  syncAlerts, closingReport, closeMonth, reopenMonth, approvePayroll, createAccessCode, verifyAccessCode, createOfficeCode, createAdminCode, verifyAdminCode, verifyOfficeLogin, verifyOfficeCode, officeMembers, accessOverview, normCode, hashCode, OFFICE_KEY, snapshot, shapeFromReview,
};
