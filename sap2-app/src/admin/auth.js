"use strict";
// Login rules for SAP2, independent of Express so the real server and the test server share exactly the same logic.
//
//   Administrator : header  x-api-key: <administrator access code>   (or the API_KEY environment variable, if set)
//   Staff (office): headers x-staff-id + x-office-code                (the code generated for that staff member's office)
//   Staff (own)   : headers x-staff-id + x-staff-code                 (optional personal code created by management)
//
// Staff can only ever reach /api/admin/* routes, and only their own records (enforced again inside the routes).
const crypto = require("crypto");
const P = require("./performance");

const WINDOW = 15 * 60 * 1000, MAX_FAILS = 10;
const cleanName = (v) => String(v || "").replace(/[^\p{L}\p{N} .'_-]/gu, "").trim().slice(0, 60) || "Administrator";
const eq = (a, b) => { const x = Buffer.from(String(a || "")), y = Buffer.from(String(b || "")); return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y); };

function createAuth({ store, ready = Promise.resolve(), apiKey = () => process.env.API_KEY, now = Date.now }) {
  const fails = new Map();
  const locked = (k) => { let f = fails.get(k); if (f && now() - f.t > WINDOW) { fails.delete(k); f = null; } return !!f && f.n >= MAX_FAILS; };
  const fail = (k) => { const f = fails.get(k) || { n: 0, t: now() }; f.n++; fails.set(k, f); };
  const tooMany = (what) => ({ ok: false, status: 429, error: `Too many wrong ${what}. Try again in 15 minutes.` });

  /** get(name) returns a request header (case-insensitive). Resolves to { ok, actor } or { ok:false, status, error }. */
  async function authenticate(get, ip) {
    const sid = get("x-staff-id"), personal = get("x-staff-code"), office = get("x-office-code");
    if (sid && (personal || office)) {
      const k = "staff|" + ip; if (locked(k)) return tooMany("codes");
      try { await ready; } catch (e) { return { ok: false, status: 503, error: "The staff portal is not ready: " + (e && e.message) }; }
      const staff = personal ? await P.verifyAccessCode(store, sid, personal) : await P.verifyOfficeCode(store, sid, office);
      if (!staff) { fail(k); return { ok: false, status: 401, error: "Wrong office code or staff selection" }; }
      return { ok: true, staffOnly: true, actor: { role: "staff", staffId: staff.id, name: staff.name } };
    }
    const given = get("x-api-key"), k = "admin|" + ip;
    if (!given) return { ok: false, status: 401, error: "Please sign in" };
    if (locked(k)) return tooMany("codes");
    const envKey = apiKey();
    let good = !!envKey && eq(given, envKey);
    if (!good) { try { await ready; good = await P.verifyAdminCode(store, given); } catch (e) { if (!envKey) return { ok: false, status: 503, error: "The access-code system is not ready: " + (e && e.message) }; } }
    if (!good) { fail(k); return { ok: false, status: 401, error: "Wrong administrator access code" }; }
    return { ok: true, actor: { role: "management", name: cleanName(get("x-actor")) } };
  }

  // Public, pre-login helpers for the login page. They reveal only office names, and staff names only after the office code is right.
  async function offices() {
    try { await ready; } catch (e) { return { status: 503, body: { error: "The login system is not ready: " + (e && e.message) } }; }
    const rows = await store.find("administrative_offices", { active: true }, { order: [["sort_order", "asc"]] });
    return { status: 200, body: rows.map((o) => ({ id: o.id, name: o.name })) };
  }
  async function officeLogin(body, ip) {
    const k = "office|" + ip; if (locked(k)) { const t = tooMany("office codes"); return { status: t.status, body: { error: t.error } }; }
    try { await ready; } catch (e) { return { status: 503, body: { error: "The login system is not ready: " + (e && e.message) } }; }
    const office = await P.verifyOfficeLogin(store, body && body.office_id, body && body.code);
    if (!office) { fail(k); return { status: 401, body: { error: "Wrong office code" } }; }
    return { status: 200, body: { office: { id: office.id, name: office.name }, members: await P.officeMembers(store, office.id) } };
  }
  return { authenticate, offices, officeLogin, _fails: fails };
}
module.exports = { createAuth, cleanName };
