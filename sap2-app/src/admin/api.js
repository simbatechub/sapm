"use strict";
// Routes under /api/admin. `handle(method, path, ctx)` returns {status, body} (or null if no route matches), so the same
// code runs under Express (mount()) and under the in-memory tests.
const E = require("./engine");
const P = require("./performance");
const { bad, conflict, forbid, notFound, HttpError } = P;

// ---------- validators ----------
const str = (v, name, { req = false, max = 4000 } = {}) => {
  if (v === undefined || v === null || String(v).trim() === "") { if (req) throw bad(`${name} is required`); return null; }
  const s = String(v).trim(); if (s.length > max) throw bad(`${name} is too long`); return s;
};
const oneOf = (v, list, name, def) => {
  if (v === undefined || v === null || v === "") { if (def !== undefined) return def; throw bad(`${name} is required`); }
  const u = String(v).toUpperCase(); if (!list.includes(u)) throw bad(`${name} must be one of ${list.join(", ")}`); return u;
};
const dateV = (v, name, req = true) => {
  if (!v) { if (req) throw bad(`${name} is required (YYYY-MM-DD)`); return null; }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v + "T00:00:00Z"))) throw bad(`${name} must be YYYY-MM-DD`); return v;
};
const monthV = (v, name = "month") => { if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(v || "")) throw bad(`${name} must be YYYY-MM`); return v; };
const timeV = (v, name) => {
  if (v === undefined || v === null || v === "") return null;
  if (!/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(v)) throw bad(`${name} must be HH:MM`); return v.length === 5 ? v + ":00" : v;
};
const numV = (v, name, { min = -Infinity, max = Infinity, req = false } = {}) => {
  if (v === undefined || v === null || v === "") { if (req) throw bad(`${name} is required`); return null; }
  const n = Number(v); if (!Number.isFinite(n) || n < min || n > max) throw bad(`${name} must be a number${min > -Infinity ? ` from ${min}` : ""}${max < Infinity ? ` to ${max}` : ""}`); return n;
};
const idV = (v, name) => { const n = Number(v); if (!Number.isInteger(n) || n <= 0) throw bad(`${name} must be a valid id`); return n; };
const boolV = (v) => v === true || v === "true" || v === 1;
const mins = (t) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
const monthOf = (d) => String(d).slice(0, 7);

const KPI_TYPES = ["PERCENTAGE", "NUMBER", "YES_NO", "RATING_10", "COMPLETION_RATE", "DEADLINE", "QUALITY"];
const AUTO = ["TASK_ON_TIME", "TASK_COMPLETION", "REPORTS_ON_TIME", "ATTENDANCE", "PUNCTUALITY", "MEETING_ATTENDANCE", "DELIVERABLE_ON_TIME"];
const EVENT_TYPES = ["WORK", "OFFICE", "MEETING", "MANDATORY_MEETING", "TRAINING", "EVENT", "OFFICIAL_ASSIGNMENT"];

function createApi({ store, today = P.todayStr, ready = Promise.resolve() }) {
  const routes = [];
  const add = (method, path, guard, fn) => {
    const keys = []; const re = new RegExp("^" + path.replace(/:(\w+)/g, (_, k) => { keys.push(k); return "([^/]+)"; }) + "/?$");
    routes.push({ method, re, keys, guard, fn });
  };
  const get = (p, g, f) => add("GET", p, g, f), post = (p, g, f) => add("POST", p, g, f), patch = (p, g, f) => add("PATCH", p, g, f), put = (p, g, f) => add("PUT", p, g, f), del = (p, g, f) => add("DELETE", p, g, f);

  const errorResponse = (e) => {
    if (e instanceof HttpError) return { status: e.status, body: { error: e.message, ...(e.extra || {}) } };
    const map = { "23505": [409, "That record already exists."], "23503": [409, "A related record is missing or still in use."], "23502": [400, "A required value is missing."], "23514": [400, "A value is not allowed."], "22P02": [400, "A value has the wrong format."], "22007": [400, "A date or time has the wrong format."], "22008": [400, "A date or time is out of range."] };
    if (e && map[e.code]) return { status: map[e.code][0], body: { error: map[e.code][1] } };
    throw e;
  };
  async function handle(method, path, { query = {}, body = {}, actor } = {}) {
    try { await ready; } catch (e) { return { status: 503, body: { error: "The administrative performance module is not ready: " + (e && e.message) } }; }
    for (const r of routes) {
      if (r.method !== method) continue;
      const m = r.re.exec(path); if (!m) continue;
      if (r.guard === "mgmt" && (!actor || actor.role !== "management")) return { status: 403, body: { error: "Management access required" } };
      const params = {}; r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
      try { return { status: 200, body: await r.fn({ params, query: query || {}, body: body || {}, actor, store, today: today() }) }; }
      catch (e) { return errorResponse(e); }
    }
    return null;
  }

  // ---------- shared helpers ----------
  const staffOf = async (store_, id) => { const s = await store_.one("staff", { id: idV(id, "staff_id") }); if (!s) throw notFound("Staff member not found"); return s; };
  const adminOf = async (store_, id) => { const s = await staffOf(store_, id); if (!P.isAdminType(s)) throw bad(`${s.name} is not administrative staff`); return s; };
  // Staff actors can only ever act on themselves.
  const who = (ctx, supplied, { optional = false } = {}) => {
    if (ctx.actor.role === "staff") { if (supplied && Number(supplied) !== ctx.actor.staffId) throw forbid("You can only access your own records"); return ctx.actor.staffId; }
    if (!supplied) { if (optional) return null; throw bad("staff_id is required"); }
    return idV(supplied, "staff_id");
  };
  const staffNames = async (s) => new Map((await s.find("staff")).map((x) => [x.id, x.name]));
  const officeMap = async (s) => new Map((await s.find("administrative_offices")).map((x) => [x.id, x]));
  const monthWhere = (month, col) => { const { from, to } = E.monthRange(monthV(month)); return { [col]: { gte: from, lt: to } }; };
  const effStatus = (a, t, today) => (t.cancelled || a.status === "CANCELLED" ? "CANCELLED" : ["TODO", "IN_PROGRESS"].includes(a.status) && t.due_date < today ? "OVERDUE" : a.status);

  // ======================= settings & offices & KPIs =======================
  get("/settings", "mgmt", async (c) => ({ settings: await P.getSettings(c.store), defaults: require("./defaults").DEFAULT_SETTINGS }));
  put("/settings", "mgmt", async (c) => ({ settings: await P.saveSettings(c.store, c.body.settings || {}, c.actor, str(c.body.reason, "reason")) }));

  get("/offices", "any", async (c) => {
    const [offices, kpis, staff] = [await c.store.find("administrative_offices", {}, { order: [["sort_order", "asc"], ["id", "asc"]] }), await c.store.find("office_kpis"), await P.adminStaff(c.store, true)];
    return offices.map((o) => ({ ...o, kpi_count: kpis.filter((k) => k.office_id === o.id && k.active).length, staff: staff.filter((s) => s.office_id === o.id).map((s) => ({ id: s.id, name: s.name })) }));
  });
  post("/offices", "mgmt", async (c) => {
    const b = c.body;
    const o = await c.store.tx(async (tx) => {
      const row = await tx.insert("administrative_offices", { code: str(b.code, "code", { req: true, max: 40 }).toUpperCase().replace(/[^A-Z0-9_]/g, "_"), name: str(b.name, "name", { req: true, max: 120 }), short_name: str(b.short_name, "short_name", { max: 40 }), purpose: str(b.purpose, "purpose"), sort_order: numV(b.sort_order, "sort_order", { min: 0 }) ?? 0 });
      let i = 0; for (const t of Array.isArray(b.responsibilities) ? b.responsibilities : []) await tx.insert("office_responsibilities", { office_id: row.id, position: ++i, text: str(t, "responsibility", { req: true }) });
      await P.audit(tx, c.actor, { action: "OFFICE_CREATED", entity: "office", entity_id: row.id, new: { name: row.name } });
      return row;
    });
    return o;
  });
  get("/offices/:id", "any", async (c) => {
    const o = await c.store.one("administrative_offices", { id: idV(c.params.id, "id") }); if (!o) throw notFound("Office not found");
    return { ...o, responsibilities: await c.store.find("office_responsibilities", { office_id: o.id }, { order: [["position", "asc"]] }), kpis: await c.store.find("office_kpis", { office_id: o.id }, { order: [["id", "asc"]] }), staff: (await P.adminStaff(c.store, true)).filter((s) => s.office_id === o.id).map((s) => ({ id: s.id, name: s.name, role: s.role })) };
  });
  patch("/offices/:id", "mgmt", async (c) => {
    const id = idV(c.params.id, "id"), b = c.body;
    return c.store.tx(async (tx) => {
      const old = await tx.one("administrative_offices", { id }); if (!old) throw notFound("Office not found");
      const patchRow = {};
      if (b.name !== undefined) patchRow.name = str(b.name, "name", { req: true, max: 120 });
      if (b.short_name !== undefined) patchRow.short_name = str(b.short_name, "short_name", { max: 40 });
      if (b.purpose !== undefined) patchRow.purpose = str(b.purpose, "purpose");
      if (b.active !== undefined) patchRow.active = boolV(b.active);
      if (b.sort_order !== undefined) patchRow.sort_order = numV(b.sort_order, "sort_order", { min: 0 });
      const [row] = Object.keys(patchRow).length ? await tx.update("administrative_offices", { id }, patchRow) : [old];
      if (Array.isArray(b.responsibilities)) {
        const before = (await tx.find("office_responsibilities", { office_id: id }, { order: [["position", "asc"]] })).map((r) => r.text);
        await tx.remove("office_responsibilities", { office_id: id });
        let i = 0; for (const t of b.responsibilities) await tx.insert("office_responsibilities", { office_id: id, position: ++i, text: str(t, "responsibility", { req: true }) });
        await P.audit(tx, c.actor, { action: "OFFICE_RESPONSIBILITIES_CHANGED", entity: "office", entity_id: id, old: { count: before.length }, new: { count: b.responsibilities.length }, reason: str(b.reason, "reason") });
      }
      if (Object.keys(patchRow).length) await P.audit(tx, c.actor, { action: "OFFICE_UPDATED", entity: "office", entity_id: id, old: Object.fromEntries(Object.keys(patchRow).map((k) => [k, old[k]])), new: patchRow });
      return row;
    });
  });

  get("/kpis", "any", async (c) => c.store.find("office_kpis", c.query.office_id ? { office_id: idV(c.query.office_id, "office_id") } : {}, { order: [["office_id", "asc"], ["id", "asc"]] }));
  const kpiFields = (b, partial) => {
    const o = {}; const has = (k) => b[k] !== undefined;
    if (!partial || has("name")) o.name = str(b.name, "name", { req: true, max: 200 });
    if (has("description")) o.description = str(b.description, "description");
    if (!partial || has("measurement_type")) o.measurement_type = oneOf(b.measurement_type, KPI_TYPES, "measurement_type", "PERCENTAGE");
    if (has("target")) o.target = numV(b.target, "target", { min: 0, req: true });
    if (has("frequency")) o.frequency = oneOf(b.frequency, ["WEEKLY", "MONTHLY", "QUARTERLY"], "frequency");
    if (has("weight")) o.weight = numV(b.weight, "weight", { min: 0, max: 1000, req: true });
    if (has("evidence_required")) o.evidence_required = boolV(b.evidence_required);
    if (has("active")) o.active = boolV(b.active);
    if (has("auto_source")) o.auto_source = b.auto_source ? oneOf(b.auto_source, AUTO, "auto_source") : null;
    return o;
  };
  post("/kpis", "mgmt", async (c) => {
    const o = { office_id: idV(c.body.office_id, "office_id"), ...kpiFields(c.body, false) };
    if (!(await c.store.one("administrative_offices", { id: o.office_id }))) throw notFound("Office not found");
    const k = await c.store.insert("office_kpis", o); await P.audit(c.store, c.actor, { action: "KPI_CREATED", entity: "kpi", entity_id: k.id, new: o }); return k;
  });
  patch("/kpis/:id", "mgmt", async (c) => {
    const id = idV(c.params.id, "id"); const old = await c.store.one("office_kpis", { id }); if (!old) throw notFound("KPI not found");
    const p = { ...kpiFields(c.body, true), updated_at: new Date().toISOString() };
    const [k] = await c.store.update("office_kpis", { id }, p);
    const changed = Object.keys(p).filter((x) => x !== "updated_at" && String(old[x]) !== String(p[x]));
    if (changed.length) await P.audit(c.store, c.actor, { action: "KPI_CONFIG_CHANGED", entity: "kpi", entity_id: id, old: Object.fromEntries(changed.map((x) => [x, old[x]])), new: Object.fromEntries(changed.map((x) => [x, p[x]])), reason: str(c.body.reason, "reason") });
    return k;
  });
  get("/kpi-results", "any", async (c) => {
    const month = monthV(c.query.month); const sid = who(c, c.query.staff_id, { optional: true });
    const staff = (await P.adminStaff(c.store)).filter((s) => (!sid || s.id === sid) && (!c.query.office_id || s.office_id === Number(c.query.office_id)));
    const oids = [...new Set(staff.map((s) => s.office_id).filter(Boolean))];
    const kpis = oids.length ? await c.store.find("office_kpis", { office_id: oids, active: true }, { order: [["id", "asc"]] }) : [];
    const results = staff.length ? await c.store.find("kpi_results", { staff_id: staff.map((s) => s.id), month: E.quarterMonths(month) }) : [];
    return { month, staff: staff.map((s) => ({ id: s.id, name: s.name, office_id: s.office_id })), kpis, results };
  });
  put("/kpi-results", "mgmt", async (c) => {
    const b = c.body, kpi_id = idV(b.kpi_id, "kpi_id"), month = monthV(b.month), staff_id = idV(b.staff_id, "staff_id");
    return c.store.tx(async (tx) => {
      const kpi = await tx.one("office_kpis", { id: kpi_id }); if (!kpi) throw notFound("KPI not found");
      const s = await adminOf(tx, staff_id); if (s.office_id !== kpi.office_id) throw bad("That KPI belongs to a different office than the staff member's office");
      await P.assertEditable(tx, staff_id, month, "KPI results");
      const isRating = ["RATING_10", "QUALITY"].includes(kpi.measurement_type);
      const value = isRating ? numV(b.rating, "rating", { min: 0, max: 10, req: true }) : numV(b.actual, "actual", { min: 0, req: true });
      if (kpi.measurement_type === "YES_NO" && ![0, 1].includes(value)) throw bad("actual must be 0 (No) or 1 (Yes)");
      const old = await tx.one("kpi_results", { kpi_id, staff_id, month });
      const oldVal = old ? (isRating ? old.rating : old.actual) : null;
      if (old && oldVal !== null && Number(oldVal) !== value && !str(b.reason, "reason")) throw bad("A reason is required to change an existing KPI result");
      const row = await tx.upsert("kpi_results", { kpi_id, staff_id, month, actual: isRating ? null : value, rating: isRating ? value : null, evidence: str(b.evidence, "evidence"), comment: str(b.comment, "comment"), entered_by: c.actor.name, updated_at: new Date().toISOString() }, ["kpi_id", "staff_id", "month"]);
      await P.audit(tx, c.actor, { action: "KPI_RESULT_SET", entity: "kpi_result", entity_id: row.id, staff_id, month, old: old ? { value: oldVal === null ? null : Number(oldVal) } : null, new: { value, kpi: kpi.name }, reason: str(b.reason, "reason") });
      return row;
    });
  });

  // ======================= staff / office mapping / access codes =======================
  get("/staff", "mgmt", async (c) => {
    const offices = await officeMap(c.store); const map = await c.store.find("office_title_map"); const codeToOffice = new Map([...offices.values()].map((o) => [o.code, o]));
    const access = new Set((await c.store.find("staff_access")).map((a) => a.staff_id));
    return (await P.adminStaff(c.store, true)).map((s) => {
      const hit = map.find((m) => m.pattern === String(s.role || "").trim().toLowerCase());
      const sug = hit ? codeToOffice.get(hit.office_code) : null;
      return { id: s.id, name: s.name, role: s.role, staff_type: s.staff_type, active: s.active, salary: s.monthly_salary || 0, office_id: s.office_id, office: s.office_id ? (offices.get(s.office_id) || {}).name : null, needs_office: !s.office_id, suggested_office_id: !s.office_id && sug ? sug.id : null, suggested_office: !s.office_id && sug ? sug.name : null, has_access_code: access.has(s.id) };
    });
  });
  post("/staff/:id/office", "mgmt", async (c) => {
    const s = await adminOf(c.store, c.params.id); const oid = c.body.office_id === null ? null : idV(c.body.office_id, "office_id");
    if (oid && !(await c.store.one("administrative_offices", { id: oid }))) throw notFound("Office not found");
    const [u] = await c.store.update("staff", { id: s.id }, { office_id: oid });
    await P.audit(c.store, c.actor, { action: "STAFF_OFFICE_ASSIGNED", entity: "staff", entity_id: s.id, staff_id: s.id, old: { office_id: s.office_id }, new: { office_id: oid }, reason: str(c.body.reason, "reason") });
    return { id: u.id, office_id: u.office_id };
  });
  post("/staff/:id/access-code", "mgmt", async (c) => ({ code: await P.createAccessCode(c.store, idV(c.params.id, "id"), c.actor), note: "Show this code to the staff member once. It cannot be viewed again; generate a new one if it is lost." }));
  del("/staff/:id/access-code", "mgmt", async (c) => { const id = idV(c.params.id, "id"); const n = await c.store.remove("staff_access", { staff_id: id }); await P.audit(c.store, c.actor, { action: "STAFF_ACCESS_CODE_REVOKED", entity: "staff_access", entity_id: id, staff_id: id }); return { revoked: n > 0 }; });
  // ---- login-page access codes (administrator + one per office). Codes are shown once and stored only as hashes. ----
  get("/access", "mgmt", async (c) => P.accessOverview(c.store));
  post("/offices/:id/office-code", "mgmt", async (c) => { const id = idV(c.params.id, "id"); const code = await P.createOfficeCode(c.store, id, c.actor); return { code, note: "Give this to the staff of that office. It is shown only once; the previous code no longer works." }; });
  post("/admin-code", "mgmt", async (c) => ({ code: await P.createAdminCode(c.store, c.actor), note: "This is the new administrator code. Write it down now; the previous code no longer works." }));
  get("/me", "any", async (c) => {
    if (c.actor.role !== "staff") return { role: "management", name: c.actor.name };
    const p = await P.staffPerformance(c.store, c.actor.staffId, c.query.month ? monthV(c.query.month) : c.today.slice(0, 7), c.today, { forStaff: true });
    const kpis = p.staff.office_id ? await c.store.find("office_kpis", { office_id: p.staff.office_id, active: true }) : [];
    return { role: "staff", ...p, kpis };
  });

  // ======================= tasks =======================
  async function listTasks(c) {
    const q = c.query; const sid = who(c, q.staff_id, { optional: true });
    const asg = await c.store.find("task_assignments", sid ? { staff_id: sid } : {});
    const tasks = new Map((asg.length ? await c.store.find("admin_tasks", { id: [...new Set(asg.map((a) => a.task_id))] }) : []).map((t) => [t.id, t]));
    const names = await staffNames(c.store), offices = await officeMap(c.store);
    const ev = asg.length ? await c.store.find("task_evidence", { assignment_id: asg.map((a) => a.id) }) : [];
    let rows = asg.filter((a) => tasks.has(a.task_id)).map((a) => {
      const t = tasks.get(a.task_id);
      return { id: a.id, task_id: t.id, title: t.title, description: t.description, office_id: t.office_id, office: t.office_id ? (offices.get(t.office_id) || {}).name : null, staff_id: a.staff_id, staff_name: names.get(a.staff_id), created_by: t.created_by, priority: t.priority, start_date: t.start_date, due_date: t.due_date, expected_output: t.expected_output, kpi_id: t.kpi_id, meeting_id: t.meeting_id, status: effStatus(a, t, c.today), stored_status: a.status, actual_output: a.actual_output, evidence_url: a.evidence_url, evidence: ev.filter((e) => e.assignment_id === a.id), submitted_at: a.submitted_at, completion_date: a.completion_date, verification_status: a.verification_status, verified_by: a.verified_by, management_comment: a.management_comment, performance_score: a.performance_score };
    });
    if (q.month) { const { from, to } = E.monthRange(monthV(q.month)); rows = rows.filter((r) => r.due_date >= from && r.due_date < to); }
    if (q.office_id) rows = rows.filter((r) => r.office_id === Number(q.office_id));
    if (q.status) rows = rows.filter((r) => r.status === String(q.status).toUpperCase());
    return rows.sort((a, b) => (a.due_date < b.due_date ? -1 : a.due_date > b.due_date ? 1 : a.id - b.id));
  }
  get("/tasks", "any", listTasks);
  async function createTasks(tx, c, { title, description, office_id, staff_ids, scope, priority, start_date, due_date, expected_output, kpi_id, meeting_id }) {
    let ids = [];
    if (scope === "OFFICE") { if (!office_id) throw bad("office_id is required when assigning to an entire office"); ids = (await P.adminStaff(tx)).filter((s) => s.office_id === office_id).map((s) => s.id); if (!ids.length) throw bad("That office has no active staff"); }
    else { ids = [...new Set((staff_ids || []).map((x) => idV(x, "staff_ids")))]; if (!ids.length) throw bad("Choose at least one staff member"); }
    const members = []; for (const id of ids) members.push(await adminOf(tx, id));
    for (const m of members) if (!m.active) throw bad(`${m.name} is inactive`);
    if (!office_id && members.length === 1) office_id = members[0].office_id;
    const t = await tx.insert("admin_tasks", { title, description, office_id: office_id || null, created_by: c.actor.name, priority, start_date, due_date, expected_output, kpi_id: kpi_id || null, meeting_id: meeting_id || null });
    for (const id of ids) await tx.insert("task_assignments", { task_id: t.id, staff_id: id });
    return { ...t, assignees: members.map((m) => ({ id: m.id, name: m.name })) };
  }
  post("/tasks", "mgmt", async (c) => {
    const b = c.body, due = dateV(b.due_date, "due_date"), start = dateV(b.start_date, "start_date", false);
    if (start && start > due) throw bad("start_date cannot be after due_date");
    const scope = oneOf(b.scope, ["STAFF", "OFFICE"], "scope", "STAFF");
    return c.store.tx((tx) => createTasks(tx, c, { title: str(b.title, "title", { req: true, max: 300 }), description: str(b.description, "description"), office_id: b.office_id ? idV(b.office_id, "office_id") : null, staff_ids: b.staff_ids, scope, priority: oneOf(b.priority, ["LOW", "MEDIUM", "HIGH"], "priority", "MEDIUM"), start_date: start, due_date: due, expected_output: str(b.expected_output, "expected_output"), kpi_id: b.kpi_id ? idV(b.kpi_id, "kpi_id") : null, meeting_id: b.meeting_id ? idV(b.meeting_id, "meeting_id") : null }));
  });
  patch("/tasks/:id", "mgmt", async (c) => {
    const id = idV(c.params.id, "id"), b = c.body;
    return c.store.tx(async (tx) => {
      const t = await tx.one("admin_tasks", { id }); if (!t) throw notFound("Task not found");
      const asg = await tx.find("task_assignments", { task_id: id }); const p = {};
      if (b.title !== undefined) p.title = str(b.title, "title", { req: true, max: 300 });
      if (b.description !== undefined) p.description = str(b.description, "description");
      if (b.priority !== undefined) p.priority = oneOf(b.priority, ["LOW", "MEDIUM", "HIGH"], "priority");
      if (b.start_date !== undefined) p.start_date = dateV(b.start_date, "start_date", false);
      if (b.due_date !== undefined) p.due_date = dateV(b.due_date, "due_date");
      if (b.expected_output !== undefined) p.expected_output = str(b.expected_output, "expected_output");
      if (b.kpi_id !== undefined) p.kpi_id = b.kpi_id ? idV(b.kpi_id, "kpi_id") : null;
      if (b.cancelled !== undefined) p.cancelled = boolV(b.cancelled);
      for (const a of asg) { await P.assertEditable(tx, a.staff_id, monthOf(t.due_date), "this task"); if (p.due_date) await P.assertEditable(tx, a.staff_id, monthOf(p.due_date), "this task"); }
      p.updated_at = new Date().toISOString();
      const [u] = await tx.update("admin_tasks", { id }, p);
      if (p.cancelled === true) for (const a of asg) if (!["VERIFIED", "COMPLETED"].includes(a.status)) await tx.update("task_assignments", { id: a.id }, { status: "CANCELLED", updated_at: p.updated_at });
      if (p.cancelled === false) for (const a of asg) if (a.status === "CANCELLED") await tx.update("task_assignments", { id: a.id }, { status: "TODO", updated_at: p.updated_at });
      await P.audit(tx, c.actor, { action: p.cancelled === true ? "TASK_CANCELLED" : "TASK_UPDATED", entity: "task", entity_id: id, old: Object.fromEntries(Object.keys(p).map((k) => [k, t[k]])), new: p, reason: str(b.reason, "reason") });
      return u;
    });
  });
  del("/tasks/:id", "mgmt", async (c) => {
    const id = idV(c.params.id, "id"); const asg = await c.store.find("task_assignments", { task_id: id });
    if (asg.some((a) => a.status !== "TODO")) throw conflict("This task already has progress or submissions. Cancel it instead of deleting it.");
    for (const a of asg) await c.store.remove("task_evidence", { assignment_id: a.id });
    await c.store.remove("task_assignments", { task_id: id }); const n = await c.store.remove("admin_tasks", { id });
    if (!n) throw notFound("Task not found"); await P.audit(c.store, c.actor, { action: "TASK_DELETED", entity: "task", entity_id: id }); return { deleted: true };
  });
  async function assignmentFor(tx, c, taskId) {
    const sid = who(c, c.body.staff_id); const a = await tx.one("task_assignments", { task_id: idV(taskId, "task id"), staff_id: sid });
    if (!a) throw notFound("That task is not assigned to this staff member"); const t = await tx.one("admin_tasks", { id: a.task_id }); return { a, t, sid };
  }
  post("/tasks/:id/start", "any", async (c) => c.store.tx(async (tx) => {
    const { a } = await assignmentFor(tx, c, c.params.id); if (a.status !== "TODO") throw conflict("Only a task that has not started can be started.");
    return (await tx.update("task_assignments", { id: a.id }, { status: "IN_PROGRESS", updated_at: new Date().toISOString() }))[0];
  }));
  post("/tasks/:id/submit", "any", async (c) => c.store.tx(async (tx) => {
    const { a, t } = await assignmentFor(tx, c, c.params.id);
    if (t.cancelled || a.status === "CANCELLED") throw conflict("This task was cancelled.");
    if (!["TODO", "IN_PROGRESS"].includes(a.status)) throw conflict(a.status === "SUBMITTED" ? "Already submitted and waiting for verification." : "This task is already verified.");
    const out = str(c.body.actual_output, "actual_output"), url = str(c.body.evidence_url, "evidence_url", { max: 1000 }); const evs = Array.isArray(c.body.evidence) ? c.body.evidence : [];
    if (!out && !url && !evs.length) throw bad("Describe the output or add evidence before submitting");
    const stamp = new Date().toISOString();
    const [u] = await tx.update("task_assignments", { id: a.id }, { status: "SUBMITTED", actual_output: out, evidence_url: url, submitted_at: stamp, submitted_date: c.today, verification_status: "PENDING", updated_at: stamp });
    for (const e of evs) await tx.insert("task_evidence", { assignment_id: a.id, kind: oneOf(e.kind, ["URL", "NOTE", "FILE"], "evidence kind", "URL"), reference: str(e.reference, "evidence reference", { req: true, max: 1000 }), description: str(e.description, "evidence description"), added_by: c.actor.name });
    return u;
  }));
  const reviewTask = (action) => async (c) => c.store.tx(async (tx) => {
    const sid = idV(c.body.staff_id, "staff_id"); const a = await tx.one("task_assignments", { task_id: idV(c.params.id, "id"), staff_id: sid }); if (!a) throw notFound("Assignment not found");
    const t = await tx.one("admin_tasks", { id: a.task_id }); await P.assertEditable(tx, sid, monthOf(t.due_date), "task verification");
    if (a.status !== "SUBMITTED") throw conflict("Only a submitted task can be verified or rejected.");
    const comment = str(c.body.comment, "comment", { req: action === "reject" }), stamp = new Date().toISOString();
    const score = c.body.performance_score === undefined || c.body.performance_score === null || c.body.performance_score === "" ? null : numV(c.body.performance_score, "performance_score", { min: 0, max: 100 });
    const p = action === "verify"
      ? { status: boolV(c.body.final) ? "COMPLETED" : "VERIFIED", verification_status: "VERIFIED", verified_by: c.actor.name, verified_at: stamp, management_comment: comment, performance_score: score, completion_date: a.submitted_date || c.today, updated_at: stamp }
      : { status: "IN_PROGRESS", verification_status: "REJECTED", verified_by: c.actor.name, verified_at: stamp, management_comment: comment, performance_score: null, updated_at: stamp };
    const [u] = await tx.update("task_assignments", { id: a.id }, p);
    await P.audit(tx, c.actor, { action: action === "verify" ? "TASK_VERIFIED" : "TASK_REJECTED", entity: "task_assignment", entity_id: a.id, staff_id: sid, month: monthOf(t.due_date), old: { status: a.status, performance_score: a.performance_score }, new: { status: p.status, performance_score: p.performance_score }, reason: comment });
    return u;
  });
  post("/tasks/:id/verify", "mgmt", reviewTask("verify"));
  post("/tasks/:id/reject", "mgmt", reviewTask("reject"));

  // ======================= activities =======================
  get("/activities", "any", async (c) => {
    const q = c.query, sid = who(c, q.staff_id, { optional: true }); const w = {};
    if (sid) w.staff_id = sid; if (q.office_id) w.office_id = Number(q.office_id);
    if (q.month) Object.assign(w, monthWhere(q.month, "activity_date")); else if (q.from || q.to) w.activity_date = { ...(q.from ? { gte: dateV(q.from, "from") } : {}), ...(q.to ? { lte: dateV(q.to, "to") } : {}) };
    const names = await staffNames(c.store);
    return (await c.store.find("admin_activities", w, { order: [["activity_date", "desc"], ["id", "desc"]], limit: 500 })).map((a) => ({ ...a, staff_name: names.get(a.staff_id) }));
  });
  get("/activities/summary", "any", async (c) => {
    const sid = who(c, c.query.staff_id, { optional: true }); const t = c.today, wk = E.mondayOf(t), mo = t.slice(0, 7);
    const all = await c.store.find("admin_activities", { ...(sid ? { staff_id: sid } : {}), activity_date: { gte: E.monthRange(mo).from, lt: E.monthRange(mo).to } });
    const n = (f) => all.filter(f).length;
    return { today: n((a) => a.activity_date === t), this_week: n((a) => a.activity_date >= wk && a.activity_date <= E.addDays(wk, 6)), this_month: all.length, completed: n((a) => a.status === "COMPLETED"), pending: n((a) => a.status !== "COMPLETED"), unreviewed: n((a) => a.review_status === "UNREVIEWED"), flagged: n((a) => a.review_status === "FLAGGED"), linked_to_task: n((a) => a.task_id) };
  });
  post("/activities", "any", async (c) => {
    const b = c.body, sid = who(c, b.staff_id); const s = await adminOf(c.store, sid);
    let task_id = null; if (b.task_id) { task_id = idV(b.task_id, "task_id"); if (!(await c.store.one("task_assignments", { task_id, staff_id: sid }))) throw bad("That task is not assigned to this staff member"); }
    return c.store.insert("admin_activities", { staff_id: sid, office_id: s.office_id, activity_date: dateV(b.activity_date || c.today, "activity_date"), activity: str(b.activity, "activity", { req: true, max: 300 }), description: str(b.description, "description"), task_id, minutes_spent: numV(b.minutes_spent, "minutes_spent", { min: 0, max: 1440 }), output: str(b.output, "output"), evidence: str(b.evidence, "evidence", { max: 1000 }), status: oneOf(b.status, ["PENDING", "IN_PROGRESS", "COMPLETED"], "status", "COMPLETED") });
  });
  patch("/activities/:id", "any", async (c) => {
    const a = await c.store.one("admin_activities", { id: idV(c.params.id, "id") }); if (!a) throw notFound("Activity not found");
    if (c.actor.role === "staff" && (a.staff_id !== c.actor.staffId || a.review_status !== "UNREVIEWED")) throw forbid("You can only edit your own activities until management reviews them");
    const b = c.body, p = {};
    if (b.activity !== undefined) p.activity = str(b.activity, "activity", { req: true, max: 300 });
    if (b.description !== undefined) p.description = str(b.description, "description");
    if (b.minutes_spent !== undefined) p.minutes_spent = numV(b.minutes_spent, "minutes_spent", { min: 0, max: 1440 });
    if (b.output !== undefined) p.output = str(b.output, "output");
    if (b.evidence !== undefined) p.evidence = str(b.evidence, "evidence", { max: 1000 });
    if (b.status !== undefined) p.status = oneOf(b.status, ["PENDING", "IN_PROGRESS", "COMPLETED"], "status");
    return (await c.store.update("admin_activities", { id: a.id }, p))[0] || a;
  });
  post("/activities/:id/review", "mgmt", async (c) => {
    const a = await c.store.one("admin_activities", { id: idV(c.params.id, "id") }); if (!a) throw notFound("Activity not found");
    const rs = oneOf(c.body.review_status, ["REVIEWED", "FLAGGED"], "review_status");
    return (await c.store.update("admin_activities", { id: a.id }, { review_status: rs, reviewed_by: c.actor.name, reviewed_at: new Date().toISOString(), review_comment: str(c.body.comment, "comment", { req: rs === "FLAGGED" }) }))[0];
  });

  // ======================= attendance =======================
  const lateInfo = (status, expected, arrival, grace) => {
    if (["ABSENT", "EXCUSED", "OFFICIAL_ASSIGNMENT"].includes(status)) return { status, late_minutes: 0 };
    if (expected && arrival) { const d = mins(arrival) - mins(expected); return d > grace ? { status: "LATE", late_minutes: d } : { status: "PRESENT", late_minutes: 0 }; }
    return { status, late_minutes: 0 };
  };
  get("/attendance", "any", async (c) => {
    const sid = who(c, c.query.staff_id, { optional: true }); const w = { ...monthWhere(c.query.month, "date") }; if (sid) w.staff_id = sid; if (c.query.office_id) w.office_id = Number(c.query.office_id);
    const names = await staffNames(c.store);
    return (await c.store.find("admin_attendance", w, { order: [["date", "desc"], ["id", "desc"]], limit: 1000 })).map((a) => ({ ...a, staff_name: names.get(a.staff_id) }));
  });
  post("/attendance", "mgmt", async (c) => {
    const list = Array.isArray(c.body.records) ? c.body.records : [c.body]; if (!list.length || list.length > 200) throw bad("Send 1 to 200 attendance records");
    const grace = (await P.getSettings(c.store)).grace_minutes;
    return c.store.tx(async (tx) => {
      const out = [];
      for (const b of list) {
        const s = await adminOf(tx, b.staff_id), date = dateV(b.date, "date"); await P.assertEditable(tx, s.id, monthOf(date), "attendance");
        const expected = timeV(b.expected_time, "expected_time"), arrival = timeV(b.arrival_time, "arrival_time"), dep = timeV(b.departure_time, "departure_time");
        let status = oneOf(b.status, ["PRESENT", "LATE", "ABSENT", "EXCUSED", "OFFICIAL_ASSIGNMENT"], "status", arrival ? "PRESENT" : undefined);
        const li = lateInfo(status, expected, arrival, grace); status = li.status;
        out.push(await tx.insert("admin_attendance", { staff_id: s.id, office_id: s.office_id, date, event_type: oneOf(b.event_type, EVENT_TYPES, "event_type", "WORK"), event_title: str(b.event_title, "event_title", { max: 200 }) || "", expected_time: expected, arrival_time: arrival, departure_time: dep, status, late_minutes: li.late_minutes, remark: str(b.remark, "remark"), recorded_by: c.actor.name }));
      }
      return out.length === 1 && !Array.isArray(c.body.records) ? out[0] : out;
    });
  });
  patch("/attendance/:id", "mgmt", async (c) => c.store.tx(async (tx) => {
    const a = await tx.one("admin_attendance", { id: idV(c.params.id, "id") }); if (!a) throw notFound("Attendance record not found");
    if (a.meeting_id) throw conflict("This record comes from a meeting. Correct it from the Meetings page.");
    const reason = str(c.body.reason, "reason", { req: true }); await P.assertEditable(tx, a.staff_id, monthOf(a.date), "attendance");
    const b = c.body, grace = (await P.getSettings(tx)).grace_minutes;
    const expected = b.expected_time !== undefined ? timeV(b.expected_time, "expected_time") : a.expected_time, arrival = b.arrival_time !== undefined ? timeV(b.arrival_time, "arrival_time") : a.arrival_time;
    let status = b.status !== undefined ? oneOf(b.status, ["PRESENT", "LATE", "ABSENT", "EXCUSED", "OFFICIAL_ASSIGNMENT"], "status") : a.status; const li = lateInfo(status, expected, arrival, grace);
    const p = { expected_time: expected, arrival_time: arrival, departure_time: b.departure_time !== undefined ? timeV(b.departure_time, "departure_time") : a.departure_time, status: li.status, late_minutes: li.late_minutes, remark: b.remark !== undefined ? str(b.remark, "remark") : a.remark, updated_at: new Date().toISOString() };
    const [u] = await tx.update("admin_attendance", { id: a.id }, p);
    await P.audit(tx, c.actor, { action: "ATTENDANCE_CORRECTED", entity: "attendance", entity_id: a.id, staff_id: a.staff_id, month: monthOf(a.date), old: { status: a.status, arrival_time: a.arrival_time, remark: a.remark }, new: { status: p.status, arrival_time: p.arrival_time, remark: p.remark }, reason });
    return u;
  }));

  // ======================= meetings =======================
  get("/meetings", "any", async (c) => {
    const w = c.query.month ? monthWhere(c.query.month, "meeting_date") : {};
    const ms = await c.store.find("meetings", w, { order: [["meeting_date", "desc"], ["id", "desc"]] });
    const att = ms.length ? await c.store.find("meeting_attendance", { meeting_id: ms.map((m) => m.id) }) : [];
    const sid = c.actor.role === "staff" ? c.actor.staffId : null;
    return ms.filter((m) => !sid || att.some((a) => a.meeting_id === m.id && a.staff_id === sid)).map((m) => { const a = att.filter((x) => x.meeting_id === m.id); const n = (s) => a.filter((x) => x.status === s).length; return { ...m, participants: a.length, present: n("PRESENT"), late: n("LATE"), absent: n("ABSENT"), excused: n("EXCUSED"), pending: n("PENDING") }; });
  });
  get("/meetings/:id", "any", async (c) => {
    const m = await c.store.one("meetings", { id: idV(c.params.id, "id") }); if (!m) throw notFound("Meeting not found");
    const names = await staffNames(c.store); let att = (await c.store.find("meeting_attendance", { meeting_id: m.id })).map((a) => ({ ...a, staff_name: names.get(a.staff_id) }));
    if (c.actor.role === "staff") { if (!att.some((a) => a.staff_id === c.actor.staffId)) throw forbid(); att = att.filter((a) => a.staff_id === c.actor.staffId); }
    return { ...m, attendance: att };
  });
  const syncParticipants = async (tx, meeting, ids) => {
    const existing = await tx.find("meeting_attendance", { meeting_id: meeting.id });
    for (const id of ids) if (!existing.some((e) => e.staff_id === id)) { await adminOf(tx, id); await tx.insert("meeting_attendance", { meeting_id: meeting.id, staff_id: id }); }
    for (const e of existing) if (!ids.includes(e.staff_id) && e.status === "PENDING") await tx.remove("meeting_attendance", { id: e.id });
  };
  const actionPoints = (v) => (Array.isArray(v) ? v : []).map((a) => ({ text: str(a.text, "action point text", { req: true }), assignee_ids: (a.assignee_ids || []).map((x) => idV(x, "assignee")), due_date: dateV(a.due_date, "action point due_date", false), priority: oneOf(a.priority, ["LOW", "MEDIUM", "HIGH"], "priority", "MEDIUM"), task_id: a.task_id || null }));
  post("/meetings", "mgmt", async (c) => {
    const b = c.body;
    return c.store.tx(async (tx) => {
      const m = await tx.insert("meetings", { title: str(b.title, "title", { req: true, max: 300 }), meeting_date: dateV(b.meeting_date, "meeting_date"), meeting_time: timeV(b.meeting_time, "meeting_time"), location: str(b.location, "location", { max: 300 }), meeting_type: oneOf(b.meeting_type, ["GENERAL", "MANDATORY", "TRAINING", "EVENT", "PROJECT"], "meeting_type", "GENERAL"), agenda: str(b.agenda, "agenda"), notes: str(b.notes, "notes"), action_points: actionPoints(b.action_points), created_by: c.actor.name });
      const ids = Array.isArray(b.required_staff_ids) && b.required_staff_ids.length ? b.required_staff_ids.map((x) => idV(x, "required_staff_ids")) : (await P.adminStaff(tx)).map((s) => s.id);
      await syncParticipants(tx, m, ids); return m;
    });
  });
  patch("/meetings/:id", "mgmt", async (c) => c.store.tx(async (tx) => {
    const m = await tx.one("meetings", { id: idV(c.params.id, "id") }); if (!m) throw notFound("Meeting not found"); const b = c.body, p = {};
    if (b.title !== undefined) p.title = str(b.title, "title", { req: true, max: 300 });
    if (b.meeting_date !== undefined) p.meeting_date = dateV(b.meeting_date, "meeting_date");
    if (b.meeting_time !== undefined) p.meeting_time = timeV(b.meeting_time, "meeting_time");
    if (b.location !== undefined) p.location = str(b.location, "location", { max: 300 });
    if (b.meeting_type !== undefined) p.meeting_type = oneOf(b.meeting_type, ["GENERAL", "MANDATORY", "TRAINING", "EVENT", "PROJECT"], "meeting_type");
    if (b.agenda !== undefined) p.agenda = str(b.agenda, "agenda");
    if (b.notes !== undefined) p.notes = str(b.notes, "notes");
    if (b.action_points !== undefined) p.action_points = actionPoints(b.action_points);
    const recorded = await tx.find("meeting_attendance", { meeting_id: m.id });
    if ((p.meeting_date || p.title) && recorded.some((r) => r.status !== "PENDING")) throw conflict("Attendance was already recorded. The title and date can no longer be changed.");
    const [u] = Object.keys(p).length ? await tx.update("meetings", { id: m.id }, p) : [m];
    if (Array.isArray(b.required_staff_ids)) await syncParticipants(tx, u, b.required_staff_ids.map((x) => idV(x, "required_staff_ids")));
    return u;
  }));
  post("/meetings/:id/attendance", "mgmt", async (c) => c.store.tx(async (tx) => {
    const m = await tx.one("meetings", { id: idV(c.params.id, "id") }); if (!m) throw notFound("Meeting not found");
    const list = Array.isArray(c.body.records) ? c.body.records : []; if (!list.length) throw bad("records must be a non-empty list");
    const grace = (await P.getSettings(tx)).grace_minutes, etype = m.meeting_type === "MANDATORY" ? "MANDATORY_MEETING" : "MEETING", out = [];
    for (const r of list) {
      const s = await adminOf(tx, r.staff_id); await P.assertEditable(tx, s.id, monthOf(m.meeting_date), "meeting attendance");
      const arrival = timeV(r.arrival_time, "arrival_time"); let status = oneOf(r.status, ["PRESENT", "LATE", "ABSENT", "EXCUSED"], "status"); const li = lateInfo(status, m.meeting_time, arrival, grace); status = li.status;
      const old = await tx.one("meeting_attendance", { meeting_id: m.id, staff_id: s.id });
      const row = await tx.upsert("meeting_attendance", { meeting_id: m.id, staff_id: s.id, required: old ? old.required : false, status, arrival_time: arrival, remark: str(r.remark, "remark"), recorded_by: c.actor.name, recorded_at: new Date().toISOString() }, ["meeting_id", "staff_id"]);
      await tx.upsert("admin_attendance", { staff_id: s.id, office_id: s.office_id, date: m.meeting_date, event_type: etype, event_title: m.title, expected_time: m.meeting_time, arrival_time: arrival, status, late_minutes: li.late_minutes, remark: str(r.remark, "remark"), meeting_id: m.id, recorded_by: c.actor.name, updated_at: new Date().toISOString() }, ["staff_id", "date", "event_type", "event_title"]);
      if (old && old.status !== "PENDING" && old.status !== status) await P.audit(tx, c.actor, { action: "MEETING_ATTENDANCE_CHANGED", entity: "meeting_attendance", entity_id: row.id, staff_id: s.id, month: monthOf(m.meeting_date), old: { status: old.status }, new: { status }, reason: str(r.reason, "reason") });
      out.push(row);
    }
    return out;
  }));
  post("/meetings/:id/convert-actions", "mgmt", async (c) => c.store.tx(async (tx) => {
    const m = await tx.one("meetings", { id: idV(c.params.id, "id") }); if (!m) throw notFound("Meeting not found");
    const pts = (m.action_points || []).map((x) => ({ ...x })); let created = 0;
    for (const ap of pts) {
      if (ap.task_id || !ap.assignee_ids || !ap.assignee_ids.length || !ap.due_date) continue;
      const t = await createTasks(tx, c, { title: ap.text.slice(0, 300), description: `Action point from meeting: ${m.title} (${m.meeting_date})`, office_id: null, staff_ids: ap.assignee_ids, scope: "STAFF", priority: ap.priority || "MEDIUM", start_date: m.meeting_date, due_date: ap.due_date, expected_output: null, kpi_id: null, meeting_id: m.id });
      ap.task_id = t.id; created++;
    }
    await tx.update("meetings", { id: m.id }, { action_points: pts });
    return { created, skipped: pts.length - created, action_points: pts };
  }));

  // ======================= weekly reports =======================
  const reportText = ["activities", "tasks_completed", "tasks_pending", "challenges", "achievements", "evidence", "next_priorities"];
  get("/reports", "any", async (c) => {
    const q = c.query, sid = who(c, q.staff_id, { optional: true }); const w = {}; if (sid) w.staff_id = sid; if (q.status) w.status = oneOf(q.status, ["DRAFT", "SUBMITTED", "APPROVED", "REJECTED"], "status");
    if (q.office_id) w.office_id = Number(q.office_id); if (q.month) Object.assign(w, monthWhere(q.month, "week_start")); if (q.week_start) w.week_start = E.mondayOf(dateV(q.week_start, "week_start"));
    const names = await staffNames(c.store);
    return (await c.store.find("weekly_reports", w, { order: [["week_start", "desc"], ["id", "desc"]], limit: 500 })).map((r) => ({ ...r, staff_name: names.get(r.staff_id), due_date: E.addDays(r.week_start, 7 + (0)) }));
  });
  const saveReport = async (c, id) => c.store.tx(async (tx) => {
    const b = c.body; let existing = id ? await tx.one("weekly_reports", { id }) : null; if (id && !existing) throw notFound("Report not found");
    const sid = who(c, existing ? existing.staff_id : b.staff_id); if (existing && existing.staff_id !== sid) throw forbid();
    const s = await adminOf(tx, sid), week = E.mondayOf(dateV(existing ? existing.week_start : b.week_start, "week_start"));
    existing = existing || (await tx.one("weekly_reports", { staff_id: sid, week_start: week }));
    if (existing && ["APPROVED"].includes(existing.status)) throw conflict("This report is already approved.");
    if (existing && existing.status === "SUBMITTED" && c.actor.role === "staff") throw conflict("Already submitted and waiting for review.");
    const text = Object.fromEntries(reportText.map((k) => [k, b[k] !== undefined ? str(b[k], k) : existing ? existing[k] : null]));
    const submit = boolV(b.submit), settings = await P.getSettings(tx);
    if (submit && !text.activities && !text.achievements) throw bad("Describe your major activities or achievements before submitting");
    const row = { staff_id: sid, office_id: s.office_id, week_start: week, ...text, updated_at: new Date().toISOString() };
    if (submit) { const due = E.addDays(week, 7 + E.num(settings.report_grace_days, 1)); Object.assign(row, { status: "SUBMITTED", submitted_at: new Date().toISOString(), on_time: existing && existing.on_time === true ? true : c.today <= due }); }
    return existing ? (await tx.update("weekly_reports", { id: existing.id }, row))[0] : tx.insert("weekly_reports", { ...row, status: submit ? "SUBMITTED" : "DRAFT" });
  });
  post("/reports", "any", (c) => saveReport(c, null));
  patch("/reports/:id", "any", (c) => saveReport(c, idV(c.params.id, "id")));
  post("/reports/:id/review", "mgmt", async (c) => c.store.tx(async (tx) => {
    const r = await tx.one("weekly_reports", { id: idV(c.params.id, "id") }); if (!r) throw notFound("Report not found");
    if (r.status !== "SUBMITTED") throw conflict("Only a submitted report can be reviewed."); await P.assertEditable(tx, r.staff_id, monthOf(r.week_start), "report reviews");
    const decision = oneOf(c.body.decision, ["APPROVED", "REJECTED"], "decision"), comment = str(c.body.comment, "comment", { req: decision === "REJECTED" });
    const [u] = await tx.update("weekly_reports", { id: r.id }, { status: decision, reviewed_by: c.actor.name, reviewed_at: new Date().toISOString(), review_comment: comment });
    await P.audit(tx, c.actor, { action: decision === "APPROVED" ? "REPORT_APPROVED" : "REPORT_REJECTED", entity: "weekly_report", entity_id: r.id, staff_id: r.staff_id, month: monthOf(r.week_start), old: { status: r.status }, new: { status: decision }, reason: comment });
    return u;
  }));

  // ======================= deliverables =======================
  get("/deliverables", "any", async (c) => {
    const q = c.query, sid = who(c, q.staff_id, { optional: true }); const w = {}; if (sid) w.staff_id = sid; if (q.status) w.status = oneOf(q.status, ["EXPECTED", "SUBMITTED", "APPROVED", "REJECTED"], "status");
    if (q.office_id) w.office_id = Number(q.office_id); if (q.month) Object.assign(w, monthWhere(q.month, "expected_date"));
    const names = await staffNames(c.store);
    return (await c.store.find("deliverables", w, { order: [["expected_date", "desc"], ["id", "desc"]], limit: 500 })).map((d) => ({ ...d, staff_name: names.get(d.staff_id), overdue: d.status === "EXPECTED" && d.expected_date < c.today }));
  });
  post("/deliverables", "mgmt", async (c) => {
    const b = c.body, s = await adminOf(c.store, b.staff_id);
    return c.store.insert("deliverables", { staff_id: s.id, office_id: s.office_id, title: str(b.title, "title", { req: true, max: 300 }), deliverable_type: str(b.deliverable_type, "deliverable_type", { max: 80 }), description: str(b.description, "description"), task_id: b.task_id ? idV(b.task_id, "task_id") : null, expected_date: dateV(b.expected_date, "expected_date"), created_by: c.actor.name });
  });
  patch("/deliverables/:id", "mgmt", async (c) => {
    const d = await c.store.one("deliverables", { id: idV(c.params.id, "id") }); if (!d) throw notFound("Deliverable not found"); await P.assertEditable(c.store, d.staff_id, monthOf(d.expected_date), "this deliverable");
    const b = c.body, p = {}; if (b.title !== undefined) p.title = str(b.title, "title", { req: true, max: 300 }); if (b.deliverable_type !== undefined) p.deliverable_type = str(b.deliverable_type, "deliverable_type", { max: 80 });
    if (b.description !== undefined) p.description = str(b.description, "description"); if (b.expected_date !== undefined) p.expected_date = dateV(b.expected_date, "expected_date");
    return (await c.store.update("deliverables", { id: d.id }, p))[0];
  });
  post("/deliverables/:id/submit", "any", async (c) => c.store.tx(async (tx) => {
    const d = await tx.one("deliverables", { id: idV(c.params.id, "id") }); if (!d) throw notFound("Deliverable not found");
    if (c.actor.role === "staff" && d.staff_id !== c.actor.staffId) throw forbid();
    if (!["EXPECTED", "REJECTED"].includes(d.status)) throw conflict("This deliverable was already submitted or approved.");
    const url = str(c.body.evidence_url, "evidence_url", { req: true, max: 1000 });
    return (await tx.update("deliverables", { id: d.id }, { status: "SUBMITTED", evidence_url: url, description: c.body.description !== undefined ? str(c.body.description, "description") : d.description, submitted_at: new Date().toISOString(), submitted_date: c.today, late: c.today > d.expected_date }))[0];
  }));
  post("/deliverables/:id/review", "mgmt", async (c) => c.store.tx(async (tx) => {
    const d = await tx.one("deliverables", { id: idV(c.params.id, "id") }); if (!d) throw notFound("Deliverable not found");
    if (d.status !== "SUBMITTED") throw conflict("Only a submitted deliverable can be reviewed."); await P.assertEditable(tx, d.staff_id, monthOf(d.expected_date), "deliverable reviews");
    const decision = oneOf(c.body.decision, ["APPROVED", "REJECTED"], "decision"), comment = str(c.body.comment, "comment", { req: decision === "REJECTED" });
    const q = c.body.quality_rating === undefined || c.body.quality_rating === null || c.body.quality_rating === "" ? null : numV(c.body.quality_rating, "quality_rating", { min: 0, max: 10 });
    const [u] = await tx.update("deliverables", { id: d.id }, { status: decision, reviewed_by: c.actor.name, reviewed_at: new Date().toISOString(), review_comment: comment, quality_rating: decision === "APPROVED" ? q : null });
    await P.audit(tx, c.actor, { action: decision === "APPROVED" ? "DELIVERABLE_APPROVED" : "DELIVERABLE_REJECTED", entity: "deliverable", entity_id: d.id, staff_id: d.staff_id, month: monthOf(d.expected_date), old: { status: d.status }, new: { status: decision, quality_rating: q }, reason: comment });
    return u;
  }));

  // ======================= performance =======================
  get("/performance", "mgmt", async (c) => { const month = monthV(c.query.month); return P.scoreboard(c.store, month, c.today, { office_id: c.query.office_id }); });
  post("/performance/calculate-all", "mgmt", async (c) => { const month = monthV(c.body.month); const out = []; for (const s of await P.adminStaff(c.store)) { try { const r = await P.calculateAndStore(c.store, s.id, month, c.actor, c.today); out.push({ staff_id: s.id, name: s.name, final_score: r.calc.final_score, status: "CALCULATED" }); } catch (e) { if (e instanceof HttpError) out.push({ staff_id: s.id, name: s.name, status: "SKIPPED", reason: e.message }); else throw e; } } return { month, results: out }; });
  post("/performance/finalize-all", "mgmt", async (c) => { const month = monthV(c.body.month); const out = []; for (const s of await P.adminStaff(c.store)) { try { const r = await P.finalizeReview(c.store, s.id, month, c.actor, { acknowledge_incomplete: boolV(c.body.acknowledge_incomplete) }, c.today); out.push({ staff_id: s.id, name: s.name, final_score: r.calc.final_score, status: "FINALIZED" }); } catch (e) { if (e instanceof HttpError) out.push({ staff_id: s.id, name: s.name, status: "SKIPPED", reason: e.message, warnings: e.extra && e.extra.warnings }); else throw e; } } return { month, results: out }; });
  get("/performance/:staff_id", "any", async (c) => { const sid = who(c, c.params.staff_id); return P.staffPerformance(c.store, sid, monthV(c.query.month), c.today, { forStaff: c.actor.role === "staff" }); });
  get("/performance/:staff_id/history", "any", async (c) => { const sid = who(c, c.params.staff_id); return (await c.store.find("performance_history", { staff_id: sid }, { order: [["month", "desc"], ["version", "desc"]] })).map(({ snapshot: _s, ...h }) => h); });
  post("/performance/:staff_id/calculate", "mgmt", async (c) => P.calculateAndStore(c.store, idV(c.params.staff_id, "staff_id"), monthV(c.body.month), c.actor, c.today));
  post("/performance/:staff_id/finalize", "mgmt", async (c) => P.finalizeReview(c.store, idV(c.params.staff_id, "staff_id"), monthV(c.body.month), c.actor, { acknowledge_incomplete: boolV(c.body.acknowledge_incomplete) }, c.today));
  post("/performance/:staff_id/reopen", "mgmt", async (c) => P.reopenReview(c.store, idV(c.params.staff_id, "staff_id"), monthV(c.body.month), c.actor, c.body.reason));
  post("/performance/:staff_id/adjust", "mgmt", async (c) => P.setOverride(c.store, idV(c.params.staff_id, "staff_id"), monthV(c.body.month), String(c.body.component || ""), c.body.value, c.body.reason, c.actor));
  put("/performance/:staff_id/teamwork", "mgmt", async (c) => P.setTeamwork(c.store, idV(c.params.staff_id, "staff_id"), monthV(c.body.month), c.body.rating, str(c.body.comment, "comment"), c.body.reason, c.actor));
  post("/performance/:staff_id/comments", "mgmt", async (c) => {
    const sid = (await adminOf(c.store, c.params.staff_id)).id, month = c.body.month ? monthV(c.body.month) : null; const kind = oneOf(c.body.kind, ["COMMENT", "WARNING", "REVIEW_NOTE"], "kind", "COMMENT");
    const row = await c.store.insert("performance_comments", { staff_id: sid, month, kind, text: str(c.body.text, "text", { req: true }), author: c.actor.name });
    if (kind === "WARNING") await P.audit(c.store, c.actor, { action: "WARNING_ISSUED", entity: "performance_comment", entity_id: row.id, staff_id: sid, month, new: { text: row.text } }); return row;
  });
  post("/performance/:staff_id/decision", "mgmt", async (c) => {
    const sid = (await adminOf(c.store, c.params.staff_id)).id, month = monthV(c.body.month); const decision = oneOf(c.body.decision, ["RETAIN", "IMPROVEMENT_PLAN", "EXIT"], "decision"); const reason = str(c.body.reason, "reason", { req: true });
    const row = await c.store.insert("performance_comments", { staff_id: sid, month, kind: "DECISION", decision, text: reason, author: c.actor.name });
    await P.audit(c.store, c.actor, { action: "MANAGEMENT_DECISION", entity: "performance_comment", entity_id: row.id, staff_id: sid, month, new: { decision }, reason });
    return { ...row, note: "Recorded. SAP2 never deactivates or removes staff automatically." };
  });

  // ======================= months, payroll approval, alerts, audit =======================
  get("/months/:month", "mgmt", async (c) => P.closingReport(c.store, monthV(c.params.month), c.today));
  post("/months/:month/close", "mgmt", async (c) => P.closeMonth(c.store, monthV(c.params.month), c.actor, { acknowledge_incomplete: boolV(c.body.acknowledge_incomplete), notes: str(c.body.notes, "notes") }, c.today));
  post("/months/:month/reopen", "mgmt", async (c) => P.reopenMonth(c.store, monthV(c.params.month), c.actor, c.body.reason));
  post("/payroll/approve", "mgmt", async (c) => ({ month: monthV(c.body.month), approved: await P.approvePayroll(c.store, c.body.month, c.body.items, c.actor) }));
  get("/alerts", "mgmt", async (c) => {
    const month = monthV(c.query.month); await P.syncAlerts(c.store, month, c.today); const names = await staffNames(c.store);
    const rank = { CRITICAL: 0, WARNING: 1, INFO: 2 };
    return (await c.store.find("performance_alerts", { month, resolved: false })).map((a) => ({ ...a, staff_name: names.get(a.staff_id) })).sort((a, b) => rank[a.severity] - rank[b.severity] || a.id - b.id);
  });
  post("/alerts/:id/ack", "mgmt", async (c) => { const [u] = await c.store.update("performance_alerts", { id: idV(c.params.id, "id") }, { acknowledged_by: c.actor.name, acknowledged_at: new Date().toISOString() }); if (!u) throw notFound("Alert not found"); return u; });
  get("/audit", "mgmt", async (c) => { const w = {}; if (c.query.staff_id) w.staff_id = Number(c.query.staff_id); if (c.query.month) w.month = monthV(c.query.month); if (c.query.action) w.action = String(c.query.action); return c.store.find("performance_audit_logs", w, { order: [["created_at", "desc"], ["id", "desc"]], limit: Math.min(Number(c.query.limit) || 100, 500) }); });

  // ======================= dashboards =======================
  get("/dashboard", "mgmt", async (c) => {
    const month = monthV(c.query.month), sb = await P.scoreboard(c.store, month, c.today); const rows = sb.rows;
    const tasks = await listTasks({ ...c, query: { month }, actor: c.actor }); const n = (s) => tasks.filter((t) => t.status === s).length;
    const sum = (f) => rows.reduce((a, r) => a + f(r), 0), withData = rows.filter((r) => r.has_data);
    const att = rows.map((r) => r.details.components.find((x) => x.component === "attendance").details.attendance_rate).filter((x) => x !== null && x !== undefined);
    const rep = rows.map((r) => r.details.components.find((x) => x.component === "reports").details);
    await P.syncAlerts(c.store, month, c.today);
    const alerts = (await c.store.find("performance_alerts", { month, resolved: false })).filter((a) => !a.acknowledged_by); const names = await staffNames(c.store);
    const act = await c.store.find("admin_activities", { activity_date: { gte: E.monthRange(month).from, lt: E.monthRange(month).to } });
    return {
      month, month_status: sb.month_status, staff_count: rows.length, average_score: withData.length ? E.r2(withData.reduce((a, r) => a + r.final_score, 0) / withData.length) : null,
      tasks: { completed: n("VERIFIED") + n("COMPLETED"), pending: n("TODO") + n("IN_PROGRESS") + n("SUBMITTED"), overdue: n("OVERDUE"), awaiting_verification: n("SUBMITTED"), total: tasks.filter((t) => t.status !== "CANCELLED").length },
      attendance_rate: att.length ? E.r2(att.reduce((a, b) => a + b, 0) / att.length) : null, reports: { submitted: rep.reduce((a, d) => a + d.approved_on_time + d.approved_late + d.awaiting_review, 0), missing: rep.reduce((a, d) => a + d.not_submitted, 0) },
      staff_at_risk: rows.filter((r) => r.has_data && r.final_score < 50).length, below_30: rows.filter((r) => r.has_data && r.final_score < sb.settings.exit_review_below).length, on_half_pay: rows.filter((r) => r.has_data && r.payment_percentage > 0 && r.payment_percentage < 100).length, full_pay: rows.filter((r) => r.has_data && r.payment_percentage >= 100).length, exit_review: rows.filter((r) => r.exit_review_required).map((r) => r.name),
      ranking: rows.map((r) => ({ rank: r.rank, staff_id: r.staff_id, name: r.name, office: r.office, final_score: r.final_score, band: r.band, has_data: r.has_data })),
      attention: alerts.slice(0, 25).map((a) => ({ id: a.id, staff_id: a.staff_id, staff_name: names.get(a.staff_id), kind: a.kind, severity: a.severity, message: a.message })),
      activities: { month: act.length, completed: act.filter((a) => a.status === "COMPLETED").length, pending: act.filter((a) => a.status !== "COMPLETED").length, today: act.filter((a) => a.activity_date === c.today).length },
      needs_office: (await P.adminStaff(c.store)).filter((s) => !s.office_id).map((s) => ({ id: s.id, name: s.name, role: s.role })),
    };
  });
  get("/offices/:id/dashboard", "mgmt", async (c) => {
    const o = await c.store.one("administrative_offices", { id: idV(c.params.id, "id") }); if (!o) throw notFound("Office not found"); const month = monthV(c.query.month);
    const sb = await P.scoreboard(c.store, month, c.today, { office_id: o.id }); const comp = (r, k) => r.details.components.find((x) => x.component === k).details;
    const tasks = (await listTasks({ ...c, query: { month, office_id: o.id } })); const qm = E.quarterMonths(month); const q = [];
    for (const mm of qm) { const s = await c.store.find("performance_reviews", { month: mm, office_id: o.id }); q.push({ month: mm, average: s.length ? E.r2(s.reduce((a, r) => a + Number(r.final_score), 0) / s.length) : null }); }
    const known = q.filter((x) => x.average !== null);
    const kp = {}; sb.rows.forEach((r) => (comp(r, "kpi").kpis || []).forEach((k) => { (kp[k.name] = kp[k.name] || []).push(k.ratio); }));
    return {
      office: o, month, office_score: sb.rows.length ? E.r2(sb.rows.reduce((a, r) => a + r.final_score, 0) / sb.rows.length) : null, staff: sb.rows.map((r) => ({ staff_id: r.staff_id, name: r.name, final_score: r.final_score, band: r.band, state: r.state })),
      tasks: { total: tasks.filter((t) => t.status !== "CANCELLED").length, completed: tasks.filter((t) => ["VERIFIED", "COMPLETED"].includes(t.status)).length, overdue: tasks.filter((t) => t.status === "OVERDUE").length },
      kpis: Object.entries(kp).map(([name, v]) => ({ name, achievement: E.r2(v.reduce((a, b) => a + b, 0) / v.length) })),
      attendance_rate: avg(sb.rows.map((r) => comp(r, "attendance").attendance_rate)), meeting_attendance_rate: avg(sb.rows.map((r) => comp(r, "attendance").meeting_rate)),
      reports: { approved: sb.rows.reduce((a, r) => a + comp(r, "reports").approved_on_time + comp(r, "reports").approved_late, 0), missing: sb.rows.reduce((a, r) => a + comp(r, "reports").not_submitted, 0) },
      deliverables: { total: sb.rows.reduce((a, r) => a + comp(r, "productivity").total, 0), approved: sb.rows.reduce((a, r) => a + comp(r, "productivity").approved, 0) },
      quarter: { months: q, average: known.length ? E.r2(known.reduce((a, b) => a + b.average, 0) / known.length) : null },
    };
  });
  const avg = (a) => { const v = a.filter((x) => x !== null && x !== undefined); return v.length ? E.r2(v.reduce((x, y) => x + y, 0) / v.length) : null; };

  // ======================= management reports =======================
  get("/performance-reports/:type", "mgmt", async (c) => {
    const type = c.params.type, month = monthV(c.query.month); const sb = await P.scoreboard(c.store, month, c.today, { office_id: c.query.office_id });
    let rows = sb.rows.filter((r) => (!c.query.staff_id || r.staff_id === Number(c.query.staff_id)) && (!c.query.band || r.band === String(c.query.band).toUpperCase()));
    const det = (r, k) => r.details.components.find((x) => x.component === k).details; const pct = (v) => (v === null || v === undefined ? "—" : `${v}%`);
    const cols = (...a) => a.map(([key, label]) => ({ key, label }));
    let title, columns, data;
    if (type === "monthly-performance") { title = "Monthly Staff Performance Report"; columns = cols(["rank", "Rank"], ["name", "Staff"], ["office", "Office"], ["task", "Task"], ["kpi", "KPI"], ["attendance", "Attendance"], ["reports", "Reports"], ["productivity", "Productivity"], ["teamwork", "Teamwork"], ["final_score", "TOTAL %"], ["band_label", "Band"], ["state", "State"]); data = rows.map((r) => ({ ...r, task: pct(r.task), kpi: pct(r.kpi), attendance: pct(r.attendance), reports: pct(r.reports), productivity: pct(r.productivity), teamwork: pct(r.teamwork) })); }
    else if (type === "office-performance") {
      title = "Office Performance Report"; columns = cols(["office", "Office"], ["staff", "Staff"], ["average", "Average score %"], ["tasks_done", "Tasks done"], ["tasks_missed", "Tasks missed"], ["attendance", "Attendance %"], ["reports_missing", "Reports missing"]);
      const g = {}; rows.forEach((r) => { (g[r.office || "No office"] = g[r.office || "No office"] || []).push(r); });
      data = Object.entries(g).map(([office, rs]) => ({ office, staff: rs.length, average: avg(rs.map((r) => r.final_score)), tasks_done: rs.reduce((a, r) => a + det(r, "task").done, 0), tasks_missed: rs.reduce((a, r) => a + det(r, "task").missed, 0), attendance: pct(avg(rs.map((r) => det(r, "attendance").attendance_rate))), reports_missing: rs.reduce((a, r) => a + det(r, "reports").not_submitted, 0) }));
    }
    else if (type === "attendance") { title = "Attendance Report"; columns = cols(["name", "Staff"], ["office", "Office"], ["records", "Records"], ["present", "Present"], ["late", "Late"], ["absent", "Absent"], ["excused", "Excused"], ["rate", "Attendance"], ["punct", "Punctuality"], ["meetings", "Meetings attended"]); data = rows.map((r) => { const d = det(r, "attendance"); return { name: r.name, office: r.office, records: d.records, present: d.present, late: d.late, absent: d.absent, excused: d.excused, rate: pct(d.attendance_rate), punct: pct(d.punctuality_rate), meetings: `${d.meetings_attended}/${d.meetings_total}` }; }); }
    else if (type === "task-completion") { title = "Task Completion Report"; columns = cols(["name", "Staff"], ["office", "Office"], ["total", "Tasks due"], ["done", "Verified"], ["on_time", "On time"], ["late", "Late"], ["missed", "Missed"], ["awaiting", "Awaiting verification"], ["rate", "Completion"]); data = rows.map((r) => { const d = det(r, "task"); return { name: r.name, office: r.office, total: d.total, done: d.done, on_time: d.on_time, late: d.late, missed: d.missed, awaiting: d.awaiting_verification, rate: pct(d.completion_rate) }; }); }
    else if (type === "kpi") { title = "KPI Report"; columns = cols(["name", "Staff"], ["office", "Office"], ["kpi", "KPI"], ["target", "Target"], ["value", "Actual"], ["ratio", "Achievement"], ["source", "Source"]); data = rows.flatMap((r) => (det(r, "kpi").kpis || []).map((k) => ({ name: r.name, office: r.office, kpi: k.name, target: k.target, value: k.value, ratio: `${k.ratio}%`, source: k.source }))); }
    else if (type === "payroll-performance") { title = "Payroll Performance Report"; columns = cols(["name", "Staff"], ["salary", "Base salary"], ["score", "Score %"], ["band", "Band"], ["recommended", "Recommended pay"], ["approved", "Approved pay"], ["paid", "Actually paid"], ["status", "Status"]); data = rows.map((r) => ({ name: r.name, salary: r.salary, score: r.final_score, band: r.band_label, recommended: r.payroll.recommended_pay, approved: r.payroll.approved_pay === null ? "—" : r.payroll.approved_pay, paid: r.payroll.actual_paid === null ? "—" : r.payroll.actual_paid, status: r.payroll.perf_status })); }
    else if (type === "staff-history") {
      if (!c.query.staff_id) throw bad("Choose a staff member for the history report"); title = "Staff Performance History"; columns = cols(["month", "Month"], ["version", "Ver."], ["task_score", "Task"], ["kpi_score", "KPI"], ["attendance_score", "Attendance"], ["report_score", "Reports"], ["productivity_score", "Productivity"], ["teamwork_score", "Teamwork"], ["final_score", "TOTAL %"], ["salary", "Salary"], ["recommended_pay", "Recommended"], ["approved_pay", "Approved"], ["payment_status", "Payment"]);
      data = await c.store.find("performance_history", { staff_id: Number(c.query.staff_id) }, { order: [["month", "desc"], ["version", "desc"]] }); data = data.map(({ snapshot: _s, ...h }) => h);
    }
    else if (type === "at-risk") { title = "At-Risk Staff Report"; columns = cols(["name", "Staff"], ["office", "Office"], ["score", "Score %"], ["band", "Band"], ["pay", "Payment"], ["flag", "Flag"]); data = rows.filter((r) => r.has_data && (r.final_score < 50 || r.exit_review_required || r.incomplete)).map((r) => ({ name: r.name, office: r.office, score: r.final_score, band: r.band_label, pay: `${r.payment_percentage}%`, flag: r.exit_review_label || (r.final_score < sb.settings.exit_review_below ? "Below payment threshold" : r.final_score < 50 ? "Below 50%" : "Data incomplete") })); }
    else throw notFound("Unknown report type");
    return { type, title, month, generated_at: new Date().toISOString(), filters: { office_id: c.query.office_id || null, staff_id: c.query.staff_id || null, band: c.query.band || null }, columns, rows: data };
  });

  return { handle, routes };
}

// ---------- Express glue ----------
function mount(app, api) {
  app.use("/api/admin", async (req, res, next) => {
    try {
      const r = await api.handle(req.method, req.path, { query: req.query, body: req.body, actor: req.actor });
      if (!r) return next();
      res.status(r.status).json(r.body);
    } catch (e) { next(e); }
  });
}

module.exports = { createApi, mount };
