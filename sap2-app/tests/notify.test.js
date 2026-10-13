"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const { memoryStore } = require("../src/admin/store");
const { createNotifier } = require("../src/admin/notify");
const W = require("../src/admin/webpush");

async function world() {
  const store = memoryStore();
  const a = await store.insert("staff", { name: "Ada", email: "ada@example.com", staff_type: "admin", active: true, monthly_salary: 0 });
  const b = await store.insert("staff", { name: "Bob", email: "nope", staff_type: "admin", active: true, monthly_salary: 0 });
  return { store, a, b };
}
const quiet = { error() {}, log() {} };

test("web push payload encrypts/decrypts and VAPID header is well formed", () => {
  const ua = crypto.createECDH("prime256v1"); ua.generateKeys(); const auth = crypto.randomBytes(16).toString("base64url");
  const body = W.encrypt(JSON.stringify({ title: "Hi ✓" }), ua.getPublicKey().toString("base64url"), auth);
  assert.equal(JSON.parse(W.decrypt(body, ua, auth)).title, "Hi ✓");
  const k = W.generateVapidKeys(); const h = W.vapidHeader("https://push.example.com/abc", { ...k, subject: "mailto:a@b.co" });
  assert.match(h, /^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=/);
  const [hd, pl, sg] = h.slice(8, h.indexOf(",")).split(".");
  const pub = Buffer.from(k.publicKey, "base64url");
  const key = crypto.createPublicKey({ key: { kty: "EC", crv: "P-256", x: pub.subarray(1, 33).toString("base64url"), y: pub.subarray(33).toString("base64url") }, format: "jwk" });
  assert.ok(crypto.verify("sha256", Buffer.from(hd + "." + pl), { key, dsaEncoding: "ieee-p1363" }, Buffer.from(sg, "base64url")), "JWT signature verifies with the public key");
});

test("notify: saved in-app always; email and push only when configured; dedupe", async () => {
  const { store, a, b } = await world();
  const none = createNotifier({ store, env: {}, log: quiet });
  const r = await none.notify([a.id, b.id], { kind: "X", title: "Hello", body: "World" }); await none.idle();
  assert.equal(r.length, 2);
  const rows = await store.find("notifications", {}); assert.ok(rows.every((x) => x.email_status === "NOT_CONFIGURED" && x.push_status === "NOT_CONFIGURED"));

  const calls = []; const fetchFn = async (url, init) => { calls.push({ url, init }); return { ok: true, status: 201 }; };
  const keys = W.generateVapidKeys();
  const env = { BREVO_API_KEY: "k", MAIL_FROM: "from@example.com", VAPID_PUBLIC_KEY: keys.publicKey, VAPID_PRIVATE_KEY: keys.privateKey };
  const ua = crypto.createECDH("prime256v1"); ua.generateKeys();
  await store.insert("push_subscriptions", { staff_id: a.id, endpoint: "https://push.example.com/a", p256dh: ua.getPublicKey().toString("base64url"), auth: crypto.randomBytes(16).toString("base64url") });
  const n = createNotifier({ store, env, fetchFn, log: quiet });
  await n.notify([a.id, b.id], { kind: "T", title: "New task: X", body: "Due soon", dedupe_key: "d1" }); await n.idle();
  assert.equal(calls.filter((c) => c.url.includes("brevo")).length, 1, "one email (Bob has an invalid address)");
  assert.equal(JSON.parse(calls.find((c) => c.url.includes("brevo")).init.body).to[0].email, "ada@example.com");
  assert.equal(calls.filter((c) => c.url.includes("push.example.com")).length, 1, "one push to Ada's phone");
  const mine = await store.find("notifications", { dedupe_key: "d1" }); const by = Object.fromEntries(mine.map((x) => [x.staff_id, x]));
  assert.equal(by[a.id].email_status, "SENT"); assert.equal(by[a.id].push_status, "SENT"); assert.equal(by[b.id].email_status, "NO_EMAIL"); assert.equal(by[b.id].push_status, "NO_DEVICE");
  assert.equal((await n.notify([a.id], { title: "again", dedupe_key: "d1" })).length, 0, "same dedupe_key is not sent twice");
});

test("dead push subscriptions are removed", async () => {
  const { store, a } = await world(); const keys = W.generateVapidKeys(); const ua = crypto.createECDH("prime256v1"); ua.generateKeys();
  await store.insert("push_subscriptions", { staff_id: a.id, endpoint: "https://push.example.com/dead", p256dh: ua.getPublicKey().toString("base64url"), auth: crypto.randomBytes(16).toString("base64url") });
  const n = createNotifier({ store, env: { VAPID_PUBLIC_KEY: keys.publicKey, VAPID_PRIVATE_KEY: keys.privateKey }, fetchFn: async () => ({ ok: false, status: 410 }), log: quiet });
  await n.notify([a.id], { title: "x" }); await n.idle();
  assert.equal((await store.find("push_subscriptions", {})).length, 0);
});

test("sms: only when flagged and configured; numbers become 234…; failures recorded", async () => {
  const { store, a } = await world(); await store.update("staff", { id: a.id }, { phone: "8160934048" });
  const calls = []; const fetchFn = async (url, init) => { calls.push({ url, body: JSON.parse(init.body) }); return { ok: true, status: 200 }; };
  const env = { TERMII_API_KEY: "k", TERMII_SENDER_ID: "SIMBATECH" };
  const n = createNotifier({ store, env, fetchFn, log: quiet });
  await n.notify([a.id], { title: "No sms", body: "x" }); await n.idle(); assert.equal(calls.length, 0, "not flagged: no SMS");
  await n.notify([a.id], { title: "Report closes tonight", body: "Submit now", sms: true }); await n.idle();
  assert.equal(calls.length, 1); assert.equal(calls[0].body.to, "2348160934048"); assert.equal(calls[0].body.from, "SIMBATECH"); assert.match(calls[0].body.sms, /Report closes tonight: Submit now/);
  assert.equal((await store.find("notifications", { title: "Report closes tonight" }))[0].sms_status, "SENT");
  await store.update("staff", { id: a.id }, { phone: "08160934048" }); await n.notify([a.id], { title: "Zero prefix", sms: true }); await n.idle(); assert.equal(calls[1].body.to, "2348160934048");
  await store.update("staff", { id: a.id }, { phone: "123" }); await n.notify([a.id], { title: "Bad number", sms: true }); await n.idle();
  assert.equal((await store.find("notifications", { title: "Bad number" }))[0].sms_status, "NO_NUMBER");
  const off = createNotifier({ store, env: {}, fetchFn, log: quiet }); await off.notify([a.id], { title: "Unconfigured", sms: true }); await off.idle();
  assert.equal((await store.find("notifications", { title: "Unconfigured" }))[0].sms_status, "NOT_CONFIGURED");
  const bad = createNotifier({ store, env, fetchFn: async () => ({ ok: false, status: 401 }), log: quiet }); await store.update("staff", { id: a.id }, { phone: "8160934048" }); await bad.notify([a.id], { title: "Rejected", sms: true }); await bad.idle();
  assert.equal((await store.find("notifications", { title: "Rejected" }))[0].sms_status, "FAILED");
});
