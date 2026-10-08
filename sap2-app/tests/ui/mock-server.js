"use strict";
// Dev/test server: serves public/ and the REAL administrative API on an in-memory store (no database needed).
// Used by the UI test. Run:  node tests/ui/mock-server.js [port]
const http = require("http"), fs = require("fs"), path = require("path");
const { memoryStore } = require("../../src/admin/store");
const { seedDefaults } = require("../../src/admin/migrate");
const { createApi } = require("../../src/admin/api");
const P = require("../../src/admin/performance");
const { createAuth } = require("../../src/admin/auth");
const { securityHeaders } = require("../../src/security");
const { adminPayrollRow } = require("../../src/admin/payroll");
const seed = require("../../data/seed.json");
const TODAY = process.env.MOCK_TODAY || "2026-10-20";
const MGT = { role: "management", name: "Mr Billy" };
(async () => {
  const store = memoryStore();
  for (const s of seed) await store.insert("staff", { name: s.name, email: s.email, phone: s.phone, bank: s.bank, account_number: s.account_number, staff_type: s.staff_type, role: s.role, monthly_salary: s.monthly_salary, campuses: s.campuses || [], skills: s.skills || [], frequency: s.frequency, per_appearance_rate: 20000, active: true });
  await seedDefaults(store);
  const api = createApi({ store, today: () => TODAY });
  const auth = createAuth({ store, apiKey: () => undefined });
  // test-only: fresh private codes (the real project never stores plaintext codes)
  const codes = { admin: await P.createAdminCode(store, { name: "test" }), offices: {} };
  for (const o of await store.find("administrative_offices")) codes.offices[o.name] = await P.createOfficeCode(store, o.id, { name: "test" });
  const appearances = [], payments = [], bonuses = [];
  const send = (res, st, b) => { res.writeHead(st, { "content-type": "application/json" }); res.end(JSON.stringify(b)); };
  async function payroll(month) {
    const staff = await store.find("staff"); const reviews = new Map((await store.find("performance_reviews", { month })).map((x) => [x.staff_id, x]));
    const enforce = (await P.getSettings(store)).enforce_payroll_approval; const rows = [];
    for (const s of staff) {
      if (s.staff_type !== "admin") { const n = appearances.filter((a) => a.staff_id === s.id && a.date.startsWith(month)).length; rows.push({ staff_id: s.id, name: s.name, pay_type: "instructor", base: n * 20000, bonus: 0, amount: n * 20000, status: n ? "Pending" : "No amount", appearances: n, rate: 20000 }); }
      if (s.staff_type !== "instructor") {
        const ap = adminPayrollRow({ enforce, salary: s.monthly_salary || 0, review: reviews.get(s.id) });
        const pay = payments.find((p) => p.staff_id === s.id && p.pay_type === "admin" && p.month === month);
        rows.push({ staff_id: s.id, name: s.name, pay_type: "admin", role: s.role, base: ap.base, bonus: 0, amount: ap.base, status: pay ? "Paid" : ap.awaiting ? "Awaiting approval" : "Pending", actual_paid: pay ? pay.amount : null, awaiting_approval: ap.awaiting, ...ap.extra });
      }
    }
    return { month, totals: { instructor: 0, admin: 0, total: 0, paid: 0, pending: 0 }, rows };
  }
  http.createServer(async (req, res) => {
    securityHeaders(req, res, () => { });
    const u = new URL(req.url, "http://x"); let raw = ""; for await (const c of req) raw += c; let body = {}; try { body = raw ? JSON.parse(raw) : {}; } catch (e) { }
    if (u.pathname === "/__test/codes") return send(res, 200, codes);
    if (u.pathname.startsWith("/api/")) {
      const p = u.pathname.slice(4); const q = Object.fromEntries(u.searchParams);
      if (p === "/health") return send(res, 200, { ok: true, auth: true });
      if (p === "/auth/offices") { const r = await auth.offices(); return send(res, r.status, r.body); }
      if (p === "/auth/office" && req.method === "POST") { const r = await auth.officeLogin(body, "ip"); return send(res, r.status, r.body); }
      const au = await auth.authenticate((h) => req.headers[h], "ip"); if (!au.ok) return send(res, au.status, { error: au.error });
      if (au.staffOnly && !p.startsWith("/admin/")) return send(res, 403, { error: "Staff accounts can only use the staff portal" });
      if (p.startsWith("/admin/")) { const r = await api.handle(req.method, p.slice(6), { query: q, body, actor: au.actor }); return r ? send(res, r.status, r.body) : send(res, 404, { error: "no route" }); }
      if (p === "/staff") return send(res, 200, (await store.find("staff")).map((s) => ({ ...s, account_len: String(s.account_number).length, phone_len: String(s.phone).length, staff_type: s.staff_type })));
      if (p === "/appearances") return send(res, 200, appearances);
      if (p === "/payments") return send(res, 200, payments);
      if (p === "/payroll") return send(res, 200, await payroll(q.month || TODAY.slice(0, 7)));
      if (p === "/payroll/pay" && req.method === "POST") { const R = (await payroll(body.month)).rows; let n = 0; const skipped = []; for (const it of body.items) { const r = R.find((x) => x.staff_id === it.staff_id && x.pay_type === it.pay_type); if (!r) continue; if (r.awaiting_approval) { skipped.push({ staff_id: r.staff_id, name: r.name, reason: "Awaiting management approval" }); continue; } payments.push({ staff_id: r.staff_id, name: r.name, pay_type: r.pay_type, amount: r.amount, month: body.month, paid_at: TODAY, reference: "REF" + payments.length }); n++; } return send(res, 200, { processed: n, skipped }); }
      return send(res, 404, { error: "no route " + p });
    }
    let f = path.join(__dirname, "../../public", u.pathname === "/" ? "index.html" : u.pathname);
    if (!fs.existsSync(f)) { res.writeHead(404); return res.end("nf"); }
    const ext = path.extname(f); res.writeHead(200, { "content-type": { ".html": "text/html", ".css": "text/css", ".js": "application/javascript", ".png": "image/png", ".jpg": "image/jpeg" }[ext] || "application/octet-stream" }); fs.createReadStream(f).pipe(res);
  }).listen(+process.argv[2] || 3100, () => console.log("mock up"));
})();
