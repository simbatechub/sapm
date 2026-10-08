"use strict";
// Login rules: administrator code, one private code per office, rate limiting, hashed storage, staff isolation.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs"), path = require("path");
const { memoryStore } = require("../src/admin/store");
const { seedDefaults } = require("../src/admin/migrate");
const { createApi } = require("../src/admin/api");
const { createAuth } = require("../src/admin/auth");
const P = require("../src/admin/performance");
const seed = require("../data/seed.json");

async function setup(opts = {}) {
  const store = memoryStore();
  for (const s of seed) await store.insert("staff", { name: s.name, email: s.email, phone: s.phone, bank: s.bank, account_number: s.account_number, staff_type: s.staff_type, role: s.role, monthly_salary: s.monthly_salary, campuses: [], skills: [], frequency: null, per_appearance_rate: 20000, active: true });
  await seedDefaults(store);
  const auth = createAuth({ store, apiKey: () => opts.apiKey, now: opts.now });
  const sys = { name: "test" }; const admin = await P.createAdminCode(store, sys);
  const offices = new Map(); for (const o of await store.find("administrative_offices")) offices.set(o.name, { ...o, code_: await P.createOfficeCode(store, o.id, sys) });
  const staff = Object.fromEntries((await store.find("staff")).map((s) => [s.name.split(" ")[0], s]));
  const H = (h) => (n) => h[n.toLowerCase()];
  return { store, auth, admin, offices, staff, H };
}

test("initial codes ship as salted hashes only, one for the administrator and one per office", async () => {
  const file = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "access-seed.json"), "utf8"));
  assert.equal(file.codes.length, 8); assert.equal(file.codes.filter((c) => c.scope === "ADMIN").length, 1); assert.equal(file.codes.filter((c) => c.scope === "OFFICE").length, 7);
  for (const c of file.codes) { assert.match(c.hash, /^[0-9a-f]{64}$/); assert.match(c.salt, /^[0-9a-f]{32}$/); assert.deepEqual(Object.keys(c).sort(), ["hash", "key", "salt", "scope"]); }
  const store = memoryStore(); await seedDefaults(store);
  assert.equal((await store.find("access_codes")).length, 8); assert.equal((await seedDefaults(store)).access_codes_created, 0, "never replaces existing codes");
});

test("format: administrator and office codes; case and dashes do not matter; new code retires the old one", async () => {
  const { store, admin, offices } = await setup();
  assert.match(admin, /^ADMIN-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  const tech = offices.get("Tech Operations Manager"); assert.match(tech.code_, /^TECH-[A-Z2-9]{5}-[A-Z2-9]{5}$/);
  assert.ok(await P.verifyAdminCode(store, admin.toLowerCase().replace(/-/g, " ")));
  assert.ok(!(await P.verifyAdminCode(store, admin.slice(0, -1) + (admin.endsWith("A") ? "B" : "A"))));
  const fresh = await P.createAdminCode(store, { name: "t" }); assert.ok(!(await P.verifyAdminCode(store, admin)), "old admin code dead"); assert.ok(await P.verifyAdminCode(store, fresh));
  const n2 = await P.createOfficeCode(store, tech.id, { name: "t" }); assert.equal(await P.verifyOfficeLogin(store, tech.id, tech.code_), null); assert.ok(await P.verifyOfficeLogin(store, tech.id, n2));
});

test("nothing is stored in readable form and the overview never exposes hashes", async () => {
  const { store, admin, offices } = await setup(); const rows = await store.find("access_codes");
  for (const r of rows) assert.ok(!JSON.stringify(r).includes(admin.replace(/-/g, "")) && !JSON.stringify(r).includes(offices.get("Content Creator").code_.replace(/-/g, "")));
  const o = JSON.stringify(await P.accessOverview(store)); assert.ok(!/hash|salt/.test(o)); assert.ok(o.includes("Content Creator"));
});

test("authenticate: administrator, API_KEY fallback, missing and wrong codes", async () => {
  const { auth, admin, H } = await setup({ apiKey: "env-secret-key" });
  assert.equal((await auth.authenticate(H({ "x-api-key": admin }), "1.1.1.1")).actor.role, "management");
  assert.equal((await auth.authenticate(H({ "x-api-key": "env-secret-key", "x-actor": "Mr Billy" }), "1.1.1.1")).actor.name, "Mr Billy");
  const none = await auth.authenticate(H({}), "1.1.1.1"); assert.equal(none.status, 401);
  const bad = await auth.authenticate(H({ "x-api-key": "ADMIN-AAAA-BBBB-CCCC" }), "1.1.1.1"); assert.equal(bad.status, 401); assert.match(bad.error, /administrator/i);
});

test("staff sign in with their OWN office's code only, and are restricted to the staff portal", async () => {
  const { auth, offices, staff, H } = await setup();
  const content = offices.get("Content Creator").code_, pa = offices.get("Personal Assistant").code_;
  const ok = await auth.authenticate(H({ "x-staff-id": String(staff.Adelana.id), "x-office-code": content }), "2.2.2.2");
  assert.ok(ok.ok && ok.staffOnly && ok.actor.role === "staff" && ok.actor.staffId === staff.Adelana.id);
  assert.equal((await auth.authenticate(H({ "x-staff-id": String(staff.Adelana.id), "x-office-code": pa }), "2.2.2.3")).status, 401, "another office's code");
  assert.equal((await auth.authenticate(H({ "x-staff-id": String(staff.Isibor.id), "x-office-code": content }), "2.2.2.4")).status, 401, "colleague from another office");
  assert.equal((await auth.authenticate(H({ "x-staff-id": String(staff.Larry.id), "x-office-code": content }), "2.2.2.5")).status, 401, "instructors have no portal");
  const personal = await P.createAccessCode((await setup()).store, 1, { name: "x" }); assert.match(personal, /^[A-Z2-9]{8}$/);
});

test("personal codes still work alongside office codes", async () => {
  const { auth, store, staff, H } = await setup(); const code = await P.createAccessCode(store, staff.Adelana.id, { name: "m" });
  assert.ok((await auth.authenticate(H({ "x-staff-id": String(staff.Adelana.id), "x-staff-code": code }), "3.3.3.3")).ok);
  assert.equal((await auth.authenticate(H({ "x-staff-id": String(staff.Adelana.id), "x-staff-code": "WRONGCODE" }), "3.3.3.3")).status, 401);
});

test("login helpers reveal office names publicly, and staff names only after the right office code", async () => {
  const { auth, offices } = await setup(); const list = await auth.offices(); assert.equal(list.body.length, 7); assert.deepEqual(Object.keys(list.body[0]).sort(), ["id", "name"]);
  const content = offices.get("Content Creator");
  const wrong = await auth.officeLogin({ office_id: content.id, code: "CONTENT-AAAAA-BBBBB" }, "4.4.4.4"); assert.equal(wrong.status, 401); assert.ok(!wrong.body.members);
  const right = await auth.officeLogin({ office_id: content.id, code: content.code_ }, "4.4.4.4"); assert.equal(right.status, 200);
  assert.deepEqual(right.body.members.map((m) => m.name), ["Adelana Victor"]); assert.deepEqual(Object.keys(right.body.members[0]).sort(), ["id", "name", "role"], "no email, phone or bank details");
});

test("ten wrong codes lock that connection for 15 minutes, then it recovers", async () => {
  let t = 1_000_000; const { auth, admin, H } = await setup({ now: () => t });
  for (let i = 0; i < 10; i++) assert.equal((await auth.authenticate(H({ "x-api-key": "WRONG-" + i }), "9.9.9.9")).status, 401);
  assert.equal((await auth.authenticate(H({ "x-api-key": admin }), "9.9.9.9")).status, 429, "locked even for the right code");
  assert.equal((await auth.authenticate(H({ "x-api-key": admin }), "8.8.8.8")).ok, true, "other connections unaffected");
  t += 15 * 60 * 1000 + 1; assert.equal((await auth.authenticate(H({ "x-api-key": admin }), "9.9.9.9")).ok, true);
  for (let i = 0; i < 10; i++) await auth.officeLogin({ office_id: 1, code: "x" + i }, "7.7.7.7"); assert.equal((await auth.officeLogin({ office_id: 1, code: "x" }, "7.7.7.7")).status, 429);
});

test("access-code routes are management-only", async () => {
  const { store, offices, staff } = await setup(); const api = createApi({ store, today: () => "2026-10-20" });
  const M = { role: "management", name: "Admin" }, S = { role: "staff", staffId: staff.Adelana.id, name: "Adelana" };
  const call = async (m, p, actor) => api.handle(m, p, { actor, body: {}, query: {} });
  const id = offices.get("Project Manager").id;
  for (const [m, p] of [["GET", "/access"], ["POST", "/admin-code"], ["POST", `/offices/${id}/office-code`]]) { assert.equal((await call(m, p, S)).status, 403, p); assert.equal((await call(m, p, M)).status, 200, p); }
  const a = (await store.find("performance_audit_logs")).map((x) => x.action); assert.ok(a.includes("ADMIN_ACCESS_CODE_CREATED") && a.includes("OFFICE_ACCESS_CODE_CREATED"));
});

test("guessing with a different faked address each time still hits a ceiling, then recovers", async () => {
  let t = 5_000_000; const { auth, admin, offices, staff, H } = await setup({ now: () => t });
  for (let i = 0; i < 60; i++) assert.equal((await auth.authenticate(H({ "x-api-key": "GUESS-" + i }), "10.0.0." + i)).status, 401, "each fake address is fresh, so still just 'wrong'");
  assert.equal((await auth.authenticate(H({ "x-api-key": "GUESS-X" }), "10.0.1.1")).status, 429, "the 61st guess is refused whatever its address");
  assert.equal((await auth.authenticate(H({ "x-api-key": admin }), "10.0.1.2")).status, 429, "the target pauses for everyone");
  t += 15 * 60 * 1000 + 1; assert.equal((await auth.authenticate(H({ "x-api-key": admin }), "10.0.1.3")).ok, true, "recovers after 15 minutes");
  // one office's code being guessed does not pause the other offices
  const tech = offices.get("Tech Operations Manager"), pm = offices.get("Project Manager");
  for (let i = 0; i < 60; i++) await auth.officeLogin({ office_id: tech.id, code: "n" + i }, "11.0.0." + i);
  assert.equal((await auth.officeLogin({ office_id: tech.id, code: tech.code_ }, "11.9.9.9")).status, 429);
  assert.equal((await auth.officeLogin({ office_id: pm.id, code: pm.code_ }, "11.9.9.9")).status, 200, "other offices unaffected");
});
