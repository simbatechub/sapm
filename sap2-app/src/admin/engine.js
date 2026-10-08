"use strict";
// Pure functions only (no database, no clock except the `today` argument) so the maths is easy to test.
// Dates are 'YYYY-MM-DD' strings, months 'YYYY-MM'.
const { DEFAULT_SETTINGS } = require("./defaults");

const COMPONENTS = ["task", "kpi", "attendance", "reports", "productivity", "teamwork"];
const COMPONENT_LABELS = { task: "Task completion", kpi: "Office KPI performance", attendance: "Attendance & punctuality", reports: "Weekly reports & documentation", productivity: "Productivity / deliverables", teamwork: "Teamwork & professionalism" };
const MEETING_TYPES = ["MEETING", "MANDATORY_MEETING"];
const r2 = (n) => Math.round(n * 100) / 100;
const num = (v, d = 0) => (v === null || v === undefined || v === "" || Number.isNaN(Number(v)) ? d : Number(v));
const clamp01 = (x) => Math.max(0, Math.min(1, x));

function mergeSettings(stored = {}) {
  const s = { ...DEFAULT_SETTINGS };
  for (const [k, v] of Object.entries(stored || {})) {
    if (!(k in DEFAULT_SETTINGS)) continue;
    s[k] = v && typeof v === "object" && !Array.isArray(v) ? { ...DEFAULT_SETTINGS[k], ...v } : v;
  }
  return s;
}

const monthRange = (month) => {
  const [y, m] = month.split("-").map(Number);
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
  return { from: `${month}-01`, to: `${next}-01` }; // from inclusive, to exclusive
};
const prevMonth = (month) => { const [y, m] = month.split("-").map(Number); return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`; };
const addDays = (d, n) => { const x = new Date(d + "T00:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const mondayOf = (d) => { const x = new Date(d + "T00:00:00Z"); return addDays(d, -((x.getUTCDay() + 6) % 7)); };
const weeksOfMonth = (month) => { // Mondays that fall inside the month
  const { from, to } = monthRange(month); const out = []; let d = mondayOf(from); if (d < from) d = addDays(d, 7);
  for (; d < to; d = addDays(d, 7)) out.push(d); return out;
};
const quarterMonths = (month) => { const [y, m] = month.split("-").map(Number); const q = Math.floor((m - 1) / 3) * 3; return [1, 2, 3].map((i) => `${y}-${String(q + i).padStart(2, "0")}`); };
const inMonth = (date, month) => !!date && String(date).slice(0, 7) === month;

// ---------- bands & pay ----------
function bandFor(score, settings) {
  const bands = [...settings.bands].sort((a, b) => a.min - b.min);
  let hit = bands[0];
  for (const b of bands) if (score >= b.min) hit = b;
  return hit;
}
function paymentFor(salary, score, settings) {
  const b = bandFor(score, settings);
  const pct = b.pay_pct;
  return {
    base_salary: salary, performance_score: score, performance_band: b.key, band_label: b.label,
    recommended_payment: Math.round((salary * pct) / 100), payment_percentage: pct,
    payment_status: pct >= 100 ? "FULL_PAYMENT" : pct <= 0 ? "NO_PAYMENT" : "PARTIAL_PAYMENT",
  };
}

// ---------- tasks ----------
const DONE = ["VERIFIED", "COMPLETED"];
function scoreTasks(rows, month, settings, today) {
  // rows: assignment+task fields: status, due_date, priority, submitted_date, performance_score, cancelled(task)
  const det = { counted: 0, done: 0, on_time: 0, late: 0, missed: 0, awaiting_verification: 0, pending_not_due: 0, rejected: 0, total: 0 };
  let num_ = 0, den = 0, onTimeDone = 0;
  for (const t of rows) {
    if (!inMonth(t.due_date, month) || t.cancelled || t.status === "CANCELLED") continue;
    det.total++;
    const w = settings.priority_weights[t.priority] || 1;
    if (DONE.includes(t.status)) {
      const onTime = !t.submitted_date || t.submitted_date <= t.due_date;
      const quality = t.performance_score === null || t.performance_score === undefined ? 1 : num(t.performance_score) / 100;
      const credit = quality * (onTime ? 1 : 1 - settings.late_task_penalty_pct / 100);
      num_ += credit * w; den += w; det.counted++; det.done++; onTime ? (det.on_time++, onTimeDone++) : det.late++;
    } else if (t.status === "SUBMITTED") det.awaiting_verification++; // not penalised until management verifies or rejects
    else if (t.due_date < today) { den += w; det.counted++; det.missed++; if (t.verification_status === "REJECTED") det.rejected++; }
    else det.pending_not_due++;
  }
  det.on_time_rate = det.counted ? r2((onTimeDone / det.counted) * 100) : null;
  det.completion_rate = det.counted ? r2((det.done / det.counted) * 100) : null;
  return { score: den ? num_ / den : null, details: det };
}

// ---------- attendance ----------
function scoreAttendance(rows, month, settings) {
  const mine = rows.filter((a) => inMonth(a.date, month));
  const att = (list) => { const c = list.filter((a) => a.status !== "EXCUSED"); return c.length ? c.filter((a) => a.status !== "ABSENT").length / c.length : null; };
  const daily = mine.filter((a) => !MEETING_TYPES.includes(a.event_type)), meet = mine.filter((a) => MEETING_TYPES.includes(a.event_type));
  const pr = mine.filter((a) => a.status === "PRESENT").length, lt = mine.filter((a) => a.status === "LATE").length;
  const parts = { daily: att(daily), meeting: att(meet), punctuality: pr + lt ? pr / (pr + lt) : null };
  const sp = settings.attendance_split;
  let n = 0, d = 0;
  for (const k of ["daily", "meeting", "punctuality"]) if (parts[k] !== null) { n += parts[k] * num(sp[k]); d += num(sp[k]); }
  const all = att(mine);
  return {
    score: d ? n / d : null,
    details: {
      records: mine.length, attendance_rate: all === null ? null : r2(all * 100), daily_rate: parts.daily === null ? null : r2(parts.daily * 100),
      meeting_rate: parts.meeting === null ? null : r2(parts.meeting * 100), punctuality_rate: parts.punctuality === null ? null : r2(parts.punctuality * 100),
      present: pr, late: lt, absent: mine.filter((a) => a.status === "ABSENT").length, excused: mine.filter((a) => a.status === "EXCUSED").length,
      official: mine.filter((a) => a.status === "OFFICIAL_ASSIGNMENT").length, meetings_attended: meet.filter((a) => ["PRESENT", "LATE", "OFFICIAL_ASSIGNMENT"].includes(a.status)).length, meetings_total: meet.filter((a) => a.status !== "EXCUSED").length,
    },
  };
}

// ---------- weekly reports ----------
function scoreReports(reports, month, settings, today) {
  const det = { weeks_due: 0, approved_on_time: 0, approved_late: 0, not_submitted: 0, rejected: 0, awaiting_review: 0, submitted_on_time: 0, submitted_late: 0 };
  let sum = 0, n = 0;
  for (const ws of weeksOfMonth(month)) {
    const due = addDays(ws, 7 + num(settings.report_grace_days, 1));
    const rep = reports.find((r) => r.week_start === ws);
    if (rep && rep.status !== "DRAFT") (rep.on_time ? det.submitted_on_time++ : det.submitted_late++);
    if (due >= today && !(rep && rep.status === "APPROVED")) continue; // not yet due
    det.weeks_due++;
    if (!rep || rep.status === "DRAFT") { n++; det.not_submitted++; }
    else if (rep.status === "SUBMITTED") det.awaiting_review++;
    else if (rep.status === "REJECTED") { n++; det.rejected++; }
    else { n++; if (rep.on_time) { sum += 1; det.approved_on_time++; } else { sum += num(settings.late_report_credit_pct, 60) / 100; det.approved_late++; } }
  }
  det.on_time_rate = n ? r2(((det.approved_on_time) / n) * 100) : null;
  return { score: n ? sum / n : null, details: det };
}

// ---------- deliverables ----------
function scoreDeliverables(rows, month, settings, today) {
  const det = { total: 0, approved: 0, approved_late: 0, rejected: 0, missed: 0, awaiting_review: 0, pending_not_due: 0 };
  let sum = 0, n = 0, onTimeApproved = 0;
  for (const d of rows) {
    if (!inMonth(d.expected_date, month)) continue;
    det.total++;
    if (d.status === "APPROVED") {
      const q = d.quality_rating === null || d.quality_rating === undefined ? 1 : num(d.quality_rating) / 10;
      const late = d.late || (d.submitted_date && d.submitted_date > d.expected_date);
      sum += q * (late ? 1 - num(settings.late_deliverable_penalty_pct, 30) / 100 : 1); n++; det.approved++; late ? det.approved_late++ : onTimeApproved++;
    } else if (d.status === "REJECTED") { n++; det.rejected++; }
    else if (d.status === "SUBMITTED") det.awaiting_review++;
    else if (d.expected_date < today) { n++; det.missed++; }
    else det.pending_not_due++;
  }
  det.on_time_rate = n ? r2((onTimeApproved / n) * 100) : null;
  return { score: n ? sum / n : null, details: det };
}

// ---------- KPIs ----------
function kpiRatio(kpi, value) {
  const target = num(kpi.target);
  if (value === null || value === undefined) return null;
  if (kpi.measurement_type === "YES_NO") return num(value) >= 1 ? 1 : 0;
  if (target <= 0) return 1;
  return clamp01(num(value) / target); // quantitative: actual/target, capped at 100% per KPI
}
function normalizeWeights(items, capPct) {
  // items: [{id, weight}] -> {id: share(0..1)}; no single KPI may exceed capPct (unless there are too few KPIs to satisfy it)
  const total = items.reduce((a, i) => a + num(i.weight), 0);
  const out = {};
  if (!items.length) return out;
  if (total <= 0) { items.forEach((i) => (out[i.id] = 1 / items.length)); return out; }
  const cap = Math.max(capPct / 100, 1 / items.length);
  let free = items.map((i) => ({ id: i.id, w: num(i.weight) })), left = 1;
  for (let guard = 0; guard < 20 && free.length; guard++) {
    const sum = free.reduce((a, f) => a + f.w, 0);
    const over = free.filter((f) => (f.w / sum) * left > cap + 1e-9);
    if (!over.length) { free.forEach((f) => (out[f.id] = (f.w / sum) * left)); return out; }
    over.forEach((f) => { out[f.id] = cap; left -= cap; });
    free = free.filter((f) => !over.includes(f));
  }
  free.forEach((f) => (out[f.id] = out[f.id] ?? 0));
  return out;
}
function scoreKpis(kpis, results, auto, month, settings) {
  const missing = [], rows = [];
  const qm = quarterMonths(month);
  for (const k of kpis.filter((x) => x.active)) {
    let res = results.find((r) => r.kpi_id === k.id && r.month === month);
    if (!res && k.frequency === "QUARTERLY") { // carry the latest result from earlier in the same quarter
      const prior = results.filter((r) => r.kpi_id === k.id && qm.includes(r.month) && r.month < month).sort((a, b) => (a.month < b.month ? 1 : -1));
      res = prior[0];
    }
    const manualValue = res ? (["RATING_10", "QUALITY"].includes(k.measurement_type) ? res.rating : res.actual) : null;
    let value = manualValue, source = manualValue === null || manualValue === undefined ? null : "management";
    if ((value === null || value === undefined) && k.auto_source && auto[k.auto_source] !== null && auto[k.auto_source] !== undefined) { value = auto[k.auto_source]; source = "system"; }
    const ratio = kpiRatio(k, value);
    if (ratio === null) { missing.push({ kpi_id: k.id, name: k.name }); continue; }
    rows.push({ kpi_id: k.id, name: k.name, type: k.measurement_type, target: num(k.target), value: num(value), ratio, source, weight: num(k.weight), evidence_missing: !!k.evidence_required && !(res && res.evidence) });
  }
  const shares = normalizeWeights(rows.map((r) => ({ id: r.kpi_id, weight: r.weight })), num(settings.kpi_weight_cap_pct, 30));
  let score = 0;
  rows.forEach((r) => { r.share = shares[r.kpi_id] || 0; r.points = r.ratio * r.share; score += r.points; });
  return { score: rows.length ? score : null, details: { scored: rows.length, missing, kpis: rows.map((r) => ({ ...r, ratio: r2(r.ratio * 100), share: r2(r.share * 100), points: r2(r.points * 100) })) } };
}

// ---------- combine ----------
function calculate(data, settingsIn, today) {
  const settings = mergeSettings(settingsIn);
  const { staff, month } = data;
  const t = scoreTasks(data.tasks || [], month, settings, today);
  const a = scoreAttendance(data.attendance || [], month, settings);
  const rp = scoreReports(data.reports || [], month, settings, today);
  const dv = scoreDeliverables(data.deliverables || [], month, settings, today);
  const auto = {
    TASK_ON_TIME: t.details.on_time_rate, TASK_COMPLETION: t.details.completion_rate, REPORTS_ON_TIME: rp.details.on_time_rate,
    ATTENDANCE: a.details.attendance_rate, PUNCTUALITY: a.details.punctuality_rate, MEETING_ATTENDANCE: a.details.meeting_rate, DELIVERABLE_ON_TIME: dv.details.on_time_rate,
  };
  const k = data.office ? scoreKpis(data.kpis || [], data.kpiResults || [], auto, month, settings) : { score: null, details: { scored: 0, missing: [], kpis: [], note: "No office assigned" } };
  const tw = data.teamwork_rating === null || data.teamwork_rating === undefined ? null : clamp01(num(data.teamwork_rating) / 10);
  const raw = { task: t.score, kpi: k.score, attendance: a.score, reports: rp.score, productivity: dv.score, teamwork: tw };
  const details = { task: t.details, kpi: k.details, attendance: a.details, reports: rp.details, productivity: dv.details, teamwork: { rating: data.teamwork_rating ?? null } };
  const overrides = data.overrides || {};
  const comps = COMPONENTS.map((c) => {
    const overridden = overrides[c] !== undefined && overrides[c] !== null;
    const value = overridden ? clamp01(num(overrides[c]) / 100) : raw[c];
    return { component: c, label: COMPONENT_LABELS[c], weight: num(settings.weights[c]), raw_score: value === null ? null : value, system_score: raw[c], overridden, override: overridden ? { value: num(overrides[c]) } : null, details: details[c] };
  });
  const zero = settings.missing_component_policy === "ZERO";
  const live = comps.filter((c) => c.raw_score !== null);
  const wTotal = zero ? comps.reduce((x, c) => x + c.weight, 0) : live.reduce((x, c) => x + c.weight, 0);
  let final = 0;
  for (const c of comps) {
    const used = c.raw_score !== null || zero;
    c.effective_weight = used && wTotal ? (c.weight / wTotal) * 100 : 0;
    c.points = used ? (c.raw_score || 0) * c.effective_weight : null;
    if (used) final += c.points;
    c.score_pct = c.raw_score === null ? null : r2(c.raw_score * 100);
    c.points = c.points === null ? null : r2(c.points); c.effective_weight = r2(c.effective_weight);
  }
  final = wTotal ? r2(final) : 0;
  const missingComps = comps.filter((c) => c.raw_score === null).map((c) => c.component);
  const warnings = [];
  if (!data.office) warnings.push("Staff member has no office assigned: KPI score cannot be calculated.");
  if (missingComps.length) warnings.push(`No data yet for: ${missingComps.map((c) => COMPONENT_LABELS[c]).join(", ")}.`);
  if (k.details.missing && k.details.missing.length) warnings.push(`${k.details.missing.length} KPI(s) have no result for ${month}.`);
  if (t.details.awaiting_verification) warnings.push(`${t.details.awaiting_verification} task(s) submitted and waiting for verification.`);
  if (rp.details.awaiting_review) warnings.push(`${rp.details.awaiting_review} weekly report(s) waiting for review.`);
  if (dv.details.awaiting_review) warnings.push(`${dv.details.awaiting_review} deliverable(s) waiting for review.`);
  const incomplete = missingComps.length > 0 || (k.details.missing || []).length > 0 || t.details.awaiting_verification > 0 || rp.details.awaiting_review > 0 || dv.details.awaiting_review > 0;
  const pay = paymentFor(num(staff.monthly_salary), final, settings);
  const below = settings.exit_review_below;
  const priorLow = (data.priorScores || []).slice(0, Math.max(0, settings.exit_review_consecutive - 1));
  const exit = wTotal > 0 && final < below && priorLow.length >= settings.exit_review_consecutive - 1 && priorLow.every((s) => s !== null && s < below);
  return {
    staff_id: staff.id, month, office_id: data.office ? data.office.id : null, office: data.office ? data.office.name : null,
    final_score: final, ...pay, components: comps, incomplete, data_quality: { warnings, missing_components: missingComps, missing_kpis: k.details.missing || [] },
    exit_review_required: exit, exit_review_label: exit ? "EXIT / MANAGEMENT REVIEW REQUIRED" : null,
    weights_total: COMPONENTS.reduce((x, c) => x + num(settings.weights[c]), 0),
  };
}

// ---------- alerts ----------
function computeAlerts(ctx, settingsIn, today) {
  const settings = mergeSettings(settingsIn); const { staff, month, calc, data } = ctx; const out = [];
  const name = staff.name; const add = (kind, severity, message, ref = "") => out.push({ staff_id: staff.id, office_id: calc.office_id, month, kind, severity, message: `${name}: ${message}`, ref });
  const overdue = (data.tasks || []).filter((t) => inMonth(t.due_date, month) && !t.cancelled && ["TODO", "IN_PROGRESS"].includes(t.status) && t.due_date < today);
  overdue.forEach((t) => add("TASK_OVERDUE", "WARNING", `task "${t.title}" was due ${t.due_date} and is not submitted`, String(t.assignment_id || t.id)));
  const rpt = calc.components.find((c) => c.component === "reports").details;
  if (rpt.not_submitted) add("REPORT_MISSING", "WARNING", `${rpt.not_submitted} weekly report(s) missing for ${month}`);
  const at = calc.components.find((c) => c.component === "attendance").details;
  if (at.attendance_rate !== null && at.attendance_rate < settings.attendance_alert_below_pct) add("ATTENDANCE_LOW", "WARNING", `attendance ${at.attendance_rate}% is below ${settings.attendance_alert_below_pct}%`);
  if (at.late >= settings.repeated_lateness_count) add("REPEATED_LATENESS", "WARNING", `late ${at.late} times in ${month}`);
  const tk = calc.components.find((c) => c.component === "task").details;
  if (tk.awaiting_verification >= settings.unverified_alert_count) add("UNVERIFIED_TASKS", "INFO", `${tk.awaiting_verification} submitted tasks are waiting for management verification`);
  const hasData = calc.components.some((c) => c.raw_score !== null);
  if (hasData && calc.final_score < settings.exit_review_below) add("PERFORMANCE_BELOW_30", "CRITICAL", `score ${calc.final_score}% is below ${settings.exit_review_below}% (no payment band)`);
  else if (hasData && calc.final_score < 50) add("PERFORMANCE_BELOW_50", "WARNING", `score ${calc.final_score}% is below 50%`);
  if (calc.exit_review_required) add("TWO_MONTHS_BELOW_30", "CRITICAL", `below ${settings.exit_review_below}% for ${settings.exit_review_consecutive} consecutive months: EXIT / MANAGEMENT REVIEW REQUIRED`);
  const kp = calc.components.find((c) => c.component === "kpi").details;
  (kp.kpis || []).filter((k) => k.ratio < settings.kpi_missed_below_pct).forEach((k) => add("KPI_MISSED", "INFO", `KPI "${k.name}" at ${k.ratio}% of target`, String(k.kpi_id)));
  return out;
}

// ---------- month closing checks ----------
function closingChecks(perStaff) {
  // perStaff: [{staff, calc, review}] -> list of {severity, staff_id, message}
  const out = [];
  for (const { staff, calc, review } of perStaff) {
    const add = (severity, message) => out.push({ severity, staff_id: staff.id, staff: staff.name, message });
    if (!calc.office_id) add("BLOCK", "No office assigned.");
    const rep = calc.components.find((c) => c.component === "reports").details;
    if (rep.not_submitted) add("WARN", `${rep.not_submitted} weekly report(s) not submitted.`);
    if (rep.awaiting_review) add("WARN", `${rep.awaiting_review} weekly report(s) not reviewed.`);
    const tk = calc.components.find((c) => c.component === "task").details;
    if (tk.awaiting_verification) add("WARN", `${tk.awaiting_verification} task(s) not verified.`);
    const at = calc.components.find((c) => c.component === "attendance");
    if (at.system_score === null) add("WARN", "No attendance recorded.");
    if (calc.data_quality.missing_kpis.length) add("WARN", `${calc.data_quality.missing_kpis.length} KPI(s) have no result.`);
    if (calc.components.find((c) => c.component === "teamwork").system_score === null) add("WARN", "No teamwork/professionalism rating.");
    if (!review || review.status === "DRAFT") add("BLOCK", "Score not finalized by management.");
  }
  return out;
}

module.exports = {
  COMPONENTS, COMPONENT_LABELS, MEETING_TYPES, mergeSettings, monthRange, prevMonth, addDays, mondayOf, weeksOfMonth, quarterMonths, bandFor, paymentFor,
  scoreTasks, scoreAttendance, scoreReports, scoreDeliverables, scoreKpis, kpiRatio, normalizeWeights, calculate, computeAlerts, closingChecks, r2, num,
};
