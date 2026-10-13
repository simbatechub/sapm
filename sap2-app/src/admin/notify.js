"use strict";
// Notifications: every message is saved in the staff member's in-app Notifications list, then (best effort) emailed
// and pushed to their phone. Email and push are switched on by environment variables; nothing here can break the
// action that triggered it.
const E = require("./engine");
const P = require("./performance");
const W = require("./webpush");

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const validEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e || ""));

function createNotifier({ store, env = process.env, fetchFn = (...a) => fetch(...a), log = console }) {
  const appUrl = (env.APP_URL || "https://sapm-7yat.onrender.com").replace(/\/$/, "");
  const provider = env.BREVO_API_KEY && env.MAIL_FROM ? "brevo" : env.RESEND_API_KEY && env.MAIL_FROM ? "resend" : null;
  const vapid = env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY ? { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY, subject: env.VAPID_SUBJECT || "mailto:" + (env.MAIL_FROM || "admin@example.com") } : null;
  const pending = new Set();
  const track = (p) => { pending.add(p); p.finally(() => pending.delete(p)); return p; };

  async function sendEmail(to, n) {
    if (!provider) return "NOT_CONFIGURED";
    if (!validEmail(to)) return "NO_EMAIL";
    const html = `<div style="font-family:Arial,sans-serif;max-width:560px"><h2 style="margin:0 0 8px">${esc(n.title)}</h2><p style="white-space:pre-line;font-size:15px;line-height:1.5">${esc(n.body)}</p>${n.no_link ? "" : `<p><a href="${appUrl}" style="background:#111;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none">Open SAP2</a></p>`}<p style="color:#888;font-size:12px">SIMBA TECHub - sent automatically from SAP2.</p></div>`;
    const text = `${n.title}\n\n${n.body || ""}${n.no_link ? "" : `\n\nOpen SAP2: ${appUrl}`}`;
    const fromName = env.MAIL_FROM_NAME || "SIMBA TECHub SAP2";
    try {
      const r = provider === "brevo"
        ? await fetchFn("https://api.brevo.com/v3/smtp/email", { method: "POST", headers: { "api-key": env.BREVO_API_KEY, "content-type": "application/json", accept: "application/json" }, body: JSON.stringify({ sender: { name: fromName, email: env.MAIL_FROM }, to: [{ email: to }], subject: n.title, htmlContent: html, textContent: text }) })
        : await fetchFn("https://api.resend.com/emails", { method: "POST", headers: { authorization: "Bearer " + env.RESEND_API_KEY, "content-type": "application/json" }, body: JSON.stringify({ from: `${fromName} <${env.MAIL_FROM}>`, to: [to], subject: n.title, html, text }) });
      if (!r.ok) { log.error("Email failed:", r.status); return "FAILED"; }
      return "SENT";
    } catch (e) { log.error("Email error:", e.message); return "FAILED"; }
  }

  async function sendPushes(staffId, n) {
    if (!vapid) return "NOT_CONFIGURED";
    const subs = await store.find("push_subscriptions", { staff_id: staffId });
    if (!subs.length) return "NO_DEVICE";
    let sent = 0;
    for (const sub of subs) {
      try {
        const r = await W.sendPush(sub, { title: n.title, body: n.body || "", tab: n.link || null, url: "/" }, vapid, fetchFn);
        if (r.ok) sent++; else if (r.gone) await store.remove("push_subscriptions", { id: sub.id });
      } catch (e) { log.error("Push error:", e.message); }
    }
    return sent ? "SENT" : "FAILED";
  }

  async function deliver(row, staff) {
    try {
      const email_status = await sendEmail(staff && staff.email, row);
      const push_status = await sendPushes(row.staff_id, row);
      await store.update("notifications", { id: row.id }, { email_status, push_status });
    } catch (e) { log.error("Notification delivery error:", e.message); }
  }

  // notify([1,2], { kind, title, body, link, dedupe_key, created_by }) -> saved rows. Delivery continues in the background.
  async function notify(staffIds, n) {
    const ids = [...new Set((staffIds || []).map(Number).filter(Boolean))]; const rows = [];
    try {
      const staff = ids.length ? await store.find("staff", { id: ids }) : []; const byId = new Map(staff.map((s) => [s.id, s]));
      for (const id of ids) {
        if (!byId.has(id)) continue;
        if (n.dedupe_key && (await store.find("notifications", { staff_id: id, dedupe_key: n.dedupe_key })).length) continue;
        const row = await store.insert("notifications", { staff_id: id, kind: n.kind || "INFO", title: String(n.title).slice(0, 200), body: n.body ? String(n.body).slice(0, 2000) : null, link: n.link || null, dedupe_key: n.dedupe_key || null, created_by: n.created_by || null });
        rows.push(row); track(deliver({ ...row, no_link: n.no_link }, byId.get(id)));
      }
    } catch (e) { log.error("Notification error:", e.message); }
    return rows;
  }

  // Timed reminders. Safe to run as often as you like: each reminder is sent once (dedupe_key).
  async function runReminders(now = new Date(), offsetHours = Number(env.SAP2_TZ_OFFSET_HOURS ?? 1)) {
    const out = { report_open: 0, report_closing: 0, task_due: 0, task_overdue: 0 };
    try {
      const today = new Date(+now + offsetHours * 3600e3).toISOString().slice(0, 10), tomorrow = E.addDays(today, 1);
      const staff = await P.adminStaff(store); const ids = staff.map((s) => s.id);
      const cw = E.mondayOf(today);
      for (const wk of [cw, E.addDays(cw, -7)]) {
        const w = E.reportWindowState(wk, now, offsetHours); if (w.state !== "OPEN") continue;
        const reps = await store.find("weekly_reports", { week_start: wk }); const done = new Set(reps.filter((r) => ["SUBMITTED", "APPROVED"].includes(r.status)).map((r) => r.staff_id));
        const todo = ids.filter((id) => !done.has(id)); const label = `${wk} to ${E.addDays(wk, 6)}`;
        out.report_open += (await notify(todo, { kind: "REPORT_OPEN", title: "Weekly report is now open", body: `Submit your weekly report for ${label}. It closes on Sunday at 11:00 pm.`, link: "rep", dedupe_key: "report-open:" + wk })).length;
        if (+now >= +w.closes - 14 * 3600e3) out.report_closing += (await notify(todo, { kind: "REPORT_CLOSING", title: "Weekly report closes tonight", body: `You have not submitted your report for ${label}. The window closes tonight at 11:00 pm.`, link: "rep", dedupe_key: "report-close:" + wk })).length;
      }
      const asg = await store.find("task_assignments", { staff_id: ids, status: ["TODO", "IN_PROGRESS"] });
      const tasks = asg.length ? await store.find("admin_tasks", { id: [...new Set(asg.map((a) => a.task_id))] }) : []; const tm = new Map(tasks.map((t) => [t.id, t]));
      for (const a of asg) {
        const t = tm.get(a.task_id); if (!t || t.cancelled) continue;
        const due = String(t.due_date).slice(0, 10);
        if (due === tomorrow || due === today) out.task_due += (await notify([a.staff_id], { kind: "TASK_DUE", title: due === today ? "Task due today" : "Task due tomorrow", body: t.title, link: "tasks", dedupe_key: `task-due:${a.id}:${due}` })).length;
        else if (due < today) out.task_overdue += (await notify([a.staff_id], { kind: "TASK_OVERDUE", title: "Task overdue", body: `${t.title} was due on ${due}.`, link: "tasks", dedupe_key: `task-overdue:${a.id}:${due}` })).length;
      }
    } catch (e) { log.error("Reminder error:", e.message); }
    return out;
  }

  return { notify, runReminders, idle: async () => { while (pending.size) await Promise.allSettled([...pending]); }, status: () => ({ email: provider, push: !!vapid, publicKey: vapid ? vapid.publicKey : null }) };
}
const noopNotifier = { notify: async () => [], runReminders: async () => ({}), idle: async () => {}, status: () => ({ email: null, push: false, publicKey: null }) };
module.exports = { createNotifier, noopNotifier };
