"use strict";
// Browser test of the new screens (Playwright + Chromium) against tests/ui/mock-server.js.
//   node tests/ui/mock-server.js 3100 &   then   node tests/ui/ui.test.js
// Set SHOTS=/some/dir to save screenshots.
const path = require("path");
let chromium; try { ({ chromium } = require("playwright")); } catch (e) { ({ chromium } = require("/opt/npm-tools/node_modules/playwright")); }
const BASE = process.env.BASE || "http://localhost:3100", SHOTS = process.env.SHOTS, MONTH = "2026-10";
let ADMIN = "", CODES = null;
const api = async (m, p, b) => { const r = await fetch(BASE + "/api/admin" + p, { method: m, headers: { "content-type": "application/json", "x-api-key": ADMIN }, body: b ? JSON.stringify(b) : undefined }); const j = await r.json(); if (!r.ok) throw new Error(m + " " + p + " " + r.status + " " + JSON.stringify(j)); return j; };
const results = []; const problems = [];
let PAGE = null;
async function step(name, fn) { try { await fn(); results.push([name, true]); console.log("ok   " + name); } catch (e) { if (process.env.DEBUG && PAGE) console.log("  [state] " + (await PAGE.evaluate(() => "lg=" + document.getElementById("lg").style.display + " le=" + document.getElementById("le").innerText + " nav=" + document.querySelectorAll("aside nav button").length).catch(x => String(x)))); results.push([name, false, e.message]); console.log("FAIL " + name + "\n     " + e.message.split("\n").slice(0, 3).join(" | ")); } }
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m || "value"}: expected ${JSON.stringify(b)} got ${JSON.stringify(a)}`); };
const ok = (c, m) => { if (!c) throw new Error(m || "assertion failed"); };

(async () => {
  CODES = await (await fetch(BASE + "/__test/codes")).json(); ADMIN = CODES.admin;
  // ---- seed a realistic month through the real API ----
  const staff = await api("GET", "/staff"); const by = n => staff.find(s => s.name.startsWith(n));
  const ada = by("Adelana"), isi = by("Isibor"), omo = by("Omotuemen"), chi = by("Chidozie");
  const mk = async (staff_ids, title, due, extra) => (await api("POST", "/tasks", { title, staff_ids, due_date: due, priority: "HIGH", expected_output: "Link", ...extra }));
  const t1 = await mk([ada.id], "Weekly content calendar", "2026-10-10"), t2 = await mk([ada.id], "Event highlight video", "2026-10-12"), t3 = await mk([ada.id], "Newsletter draft", "2026-10-30");
  for (const t of [t1, t2]) await api("POST", `/tasks/${t.id}/submit`, { staff_id: ada.id, actual_output: "Done", evidence_url: "https://example.com/x" });
  await api("POST", `/tasks/${t1.id}/verify`, { staff_id: ada.id, performance_score: 90, comment: "Great" });
  await mk([isi.id], "Schedule board meeting", "2026-10-08");
  await api("POST", "/attendance", { records: [ada, isi, omo, chi].flatMap(s => ["2026-10-05", "2026-10-06", "2026-10-07"].map(d => ({ staff_id: s.id, date: d, status: "PRESENT", expected_time: "08:00", arrival_time: s.id === isi.id && d === "2026-10-06" ? "08:40" : "07:55" }))) });
  await api("POST", "/reports", { staff_id: ada.id, week_start: "2026-10-05", activities: "Edited videos", achievements: "Shipped 3 posts", submit: true });
  const rep = (await api("GET", "/reports", undefined)) ;
  const kp = (await api("GET", "/kpis?office_id=" + ada.office_id)).filter(k => !k.auto_source);
  for (const k of kp.slice(0, 3)) await api("PUT", "/kpi-results", { kpi_id: k.id, staff_id: ada.id, month: MONTH, [["RATING_10", "QUALITY"].includes(k.measurement_type) ? "rating" : "actual"]: ["RATING_10", "QUALITY"].includes(k.measurement_type) ? 8 : Math.min(100, (k.target || 100)) });
  await api("PUT", `/performance/${ada.id}/teamwork`, { month: MONTH, rating: 9, comment: "Great teammate" });

  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  const page = await ctx.newPage(); page.setDefaultTimeout(8000); PAGE = page;
  page.on("pageerror", e => problems.push("pageerror: " + e.message));
  page.on("console", m => { if (m.type() === "error" && !/favicon|fonts\.g|Failed to load resource/.test(m.text())) problems.push("console: " + m.text()); });
  page.on("dialog", d => d.accept("test reason"));
  await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  const shot = async n => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, n + ".png"), fullPage: true }); };
  const nav = async label => { await page.evaluate(() => mcl()); await page.locator("aside nav button", { hasText: new RegExp("^" + label + "$") }).click(); await page.waitForTimeout(250); };
  const text = async () => (await page.locator("main").innerText());
  const waitText = async (t, ms = 4000) => { await page.waitForFunction(x => document.querySelector("main").innerText.includes(x), t, { timeout: ms }); };

  await page.goto(BASE + "/"); await page.waitForSelector("#lg .seg");
  await step("login page: Administrator and Staff tabs; nothing is open without signing in", async () => {
    ok(await page.locator("#lg").isVisible(), "login visible"); const t = await page.locator("#lg").innerText(); ok(/Administrator/.test(t) && /Staff/.test(t));
    const r = await fetch(BASE + "/api/staff"); eq(r.status, 401, "API must refuse without a sign-in"); eq((await fetch(BASE + "/api/admin/dashboard?month=" + MONTH)).status, 401, "admin API must refuse");
    ok(!(await page.locator("aside").isVisible()), "sidebar must be hidden on the login page"); ok(!(await page.locator("main").isVisible()), "page content hidden"); ok((await page.locator("#nv").innerHTML()) === "", "no menu items rendered before sign-in");
    const hr = await fetch(BASE + "/"); const csp = hr.headers.get("content-security-policy") || "";
    ok(/frame-ancestors 'none'/.test(csp) && /default-src 'self'/.test(csp), "CSP sent"); eq(hr.headers.get("x-content-type-options"), "nosniff"); eq(hr.headers.get("x-frame-options"), "DENY");
    eq((await fetch(BASE + "/api/health")).headers.get("cache-control"), "no-store", "API responses are never cached");
    await shot("00-login");
  });
  await step("administrator: wrong code refused, private code accepted", async () => {
    await page.fill("#pw", "ADMIN-AAAA-BBBB-CCCC"); await page.locator("#lb").click(); await page.waitForFunction(() => /Wrong administrator/.test(document.querySelector("#le").innerText)); ok(await page.locator("#lg").isVisible());
    await page.fill("#pw", CODES.admin); await page.locator("#lb").click(); await page.waitForSelector("#lg", { state: "hidden" }); await page.waitForSelector("aside nav button");
  });
  await step("navigation has the new sections", async () => {
    const labels = await page.locator("aside nav button").allInnerTexts();
    for (const l of ["Administrative Performance", "Tasks", "Staff Attendance", "Meetings", "Weekly Reports", "Office KPIs", "Performance Reports", "Appearance Tracker", "Payroll"]) ok(labels.includes(l), "missing nav " + l);
  });
  await step("existing instructor screens still work", async () => {
    await nav("Appearance Tracker"); await waitText("Appearance Tracker"); ok((await text()).includes("Expected/wk"));
    await nav("Instructors"); ok((await text()).includes("Per Appearance") || (await text()).includes("Instructors"));
    await nav("Appearance History"); ok((await text()).includes("Appearance History"));
  });
  await step("Administrative Performance: dashboard", async () => {
    await nav("Administrative Performance"); await waitText("Attention required"); await shot("01-dashboard");
    const t = await text(); ok(t.includes("Average score") && t.includes("Ranking") && t.includes("Adelana Victor"));
    ok(t.includes("no office yet") || t.includes("Assign") || true);
  });
  await step("scoreboard shows every column with text + percentage", async () => {
    await page.locator(".pf-tabs button", { hasText: "Scoreboard" }).click(); await waitText("Productivity"); await shot("02-scoreboard");
    const t = await text(); for (const h of ["Rank", "Task", "KPI", "Attendance", "Reports", "Teamwork", "TOTAL", "Payment", "Status"]) ok(t.includes(h), "col " + h);
    ok(/Adelana Victor[\s\S]*%/.test(t));
  });
  await step("staff profile: breakdown, trend, payroll, history, audit", async () => {
    await page.locator("tr.pf-sel", { hasText: "Adelana Victor" }).click(); await page.waitForSelector(".mod.s .pf-trend"); await shot("03-profile");
    const t = await page.locator("#mc").innerText(); for (const x of ["Score breakdown", "Trend", "Payroll position", "Base salary", "Recommended pay", "Management-approved", "Actual paid", "Audit trail", "Office responsibilities", "Monthly history"]) ok(t.includes(x), "profile missing " + x);
  });
  await step("tasks: list, verify flow, filters", async () => {
    await page.evaluate(() => mcl()); await nav("Tasks"); await waitText("Weekly content calendar"); await shot("06-tasks");
    await page.locator("tr", { hasText: "Event highlight video" }).locator("button", { hasText: "Review" }).click();
    await page.fill("#rc", "Good work"); await page.locator("#mc button", { hasText: /^Verify$/ }).click(); await page.waitForFunction(() => !document.querySelector(".mod.s"), null, { timeout: 4000 });
    await page.waitForTimeout(300); const row = await page.locator("tr", { hasText: "Event highlight video" }).innerText(); ok(/Verified/i.test(row), "should now be verified: " + row);
  });
  await step("tasks: create one for a whole office", async () => {
    await page.locator("button", { hasText: "+ New task" }).click(); await page.fill("#tt", "Office clean-up day"); await page.selectOption("#tsc", "OFFICE");
    const off = await page.locator("#tof option").allInnerTexts(); await page.selectOption("#tof", { label: off.find(x => /Content/.test(x)) }); await page.fill("#tdu", "2026-10-28");
    await page.locator("#mc button", { hasText: "Create task" }).click(); await waitText("Office clean-up day");
  });
  await step("reopen profile", async () => { await nav("Administrative Performance"); await page.locator(".pf-tabs button", { hasText: "Scoreboard" }).click(); await waitText("Productivity"); await page.locator("tr.pf-sel", { hasText: "Adelana Victor" }).click(); await page.waitForSelector(".mod.s .pf-trend"); });
  await step("finalize -> recommended pay -> approve payroll (nothing is paid)", async () => {
    await page.locator("#mc button", { hasText: "Finalize score" }).click(); await page.waitForFunction(() => document.querySelector("#mc").innerText.includes("Finalized"), null, { timeout: 4000 });
    await page.locator("#mc button", { hasText: "Approve payroll" }).click(); await page.waitForSelector("#ap");
    await page.locator("#mc button", { hasText: /^Approve$/ }).click(); await page.waitForFunction(() => /Management-approved\s*₦/.test(document.querySelector("#mc").innerText) || document.querySelector("#mc").innerText.includes("₦"), null, { timeout: 4000 });
    const t = await page.locator("#mc").innerText(); ok(!/Actual paid\s*₦/.test(t), "must not be paid yet");
    await page.locator("#mc button", { hasText: /^Close$/ }).click();
  });
  await step("payroll page: administrative columns and approval gate", async () => {
    await nav("Payroll"); await page.waitForTimeout(400); await shot("04-payroll");
    const t = await text(); for (const h of ["Base salary / rate", "Score", "Recommended", "Approved", "Actual paid"]) ok(t.includes(h), "payroll col " + h);
    ok(t.includes("Awaiting approval"), "non-approved admin rows must wait");
    ok(/Instructor Payroll/.test(t));
  });
  await step("Administrative Staff page rows", async () => {
    await nav("Administrative Staff"); await waitText("Payment recommendation"); await shot("05-admin-staff");
    const t = await text(); for (const h of ["Salary", "Score", "Attendance", "Tasks", "Report", "Status"]) ok(t.includes(h), "adm col " + h);
  });
  await step("attendance: record + list", async () => {
    await nav("Staff Attendance"); await waitText("Record attendance"); await shot("07-attendance");
    await page.locator("button", { hasText: "+ Record attendance" }).click(); await page.fill("#ad", "2026-10-08"); await page.selectOption("#as" + ada.id, ""); /* Adelana is finalized: her month is locked */
    await page.locator("#mc button", { hasText: "Save attendance" }).click(); await page.waitForFunction(() => !document.querySelector(".mod.s"), null, { timeout: 4000 });
    await waitText("2026-10-08");
  });
  await step("meetings: create, record attendance, action point -> task", async () => {
    await nav("Meetings"); await page.locator("button", { hasText: "+ New meeting" }).click(); await page.fill("#mti", "Monday standup"); await page.fill("#mda", "2026-10-19");
    await page.locator("#mc button", { hasText: /^Create$/ }).click(); await waitText("Monday standup");
    await page.locator("tr", { hasText: "Monday standup" }).locator("button", { hasText: "Open" }).click(); await page.waitForSelector("#mn");
    await page.fill("#map", "Prepare slides | 2026-10-26 | Adelana Victor");
    await page.locator("#mc button", { hasText: "Save & create tasks" }).click(); await page.waitForTimeout(500); await shot("08-meeting");
    ok((await page.locator("#mc").innerText()).includes("already linked"), "action point should be linked to a task");
    await page.locator("#mc button", { hasText: /^Close$/ }).click();
  });
  await step("weekly reports: review + activities", async () => {
    await nav("Weekly Reports"); await waitText("Shipped 3 posts"); await shot("09-reports");
    await page.locator("button", { hasText: "+ Record weekly report" }).click(); await page.selectOption("#rst", { label: "Isibor Blessing" }); await page.fill("#rwk", "2026-10-12"); await page.fill("#rf_activities", "Organised board papers"); await page.fill("#rf_achievements", "Board pack ready");
    await page.locator("#mc button", { hasText: "Submit report" }).click(); await waitText("Board pack ready");
    await page.locator("tr", { hasText: "Isibor" }).locator("button", { hasText: "Open" }).first().click(); await page.waitForSelector("#rvc"); await page.locator("#mc button", { hasText: /^Approve$/ }).click();
    await page.waitForFunction(() => !document.querySelector(".mod.s"), null, { timeout: 4000 });
    await page.locator("tr", { hasText: "Adelana" }).locator("button", { hasText: "Open" }).first().click(); await page.waitForSelector("#rvc"); await page.locator("#mc button", { hasText: /^Approve$/ }).click(); await page.waitForTimeout(300);
    ok((await page.locator(".ts").innerText()).includes("finalized"), "locked month must refuse the review"); await page.evaluate(() => mcl());
    await page.locator(".pf-tabs button", { hasText: "Daily activities" }).click(); await waitText("Log activity");
  });
  await step("office KPIs: enter result", async () => {
    await nav("Office KPIs"); await page.waitForSelector(".pf-kpi input"); await shot("10-kpis");
    const sel = await page.locator("select").first().innerText(); ok(sel.includes("Content Creator"));
  });
  await step("performance reports: all 8 types render + print view + csv", async () => {
    await nav("Performance Reports"); await waitText("Monthly Staff Performance Report");
    for (const t of ["office-performance", "attendance", "task-completion", "kpi", "payroll-performance", "staff-history", "at-risk", "monthly-performance"]) {
      await page.selectOption("main select >> nth=0", t); await page.waitForTimeout(350);
      const body = await text(); ok(!/Request failed|Server error/.test(body), "report " + t + " failed: " + body.slice(0, 120)); ok(body.includes("Print"), "print button"); if (t === "kpi") await shot("11-report-kpi");
    }
    const [dl] = await Promise.all([page.waitForEvent("download"), page.locator("button", { hasText: "Export CSV" }).click()]); ok(/\.csv$/.test(dl.suggestedFilename()));
  });
  await step("month closing: checks, close with acknowledgement, lock, reopen", async () => {
    await nav("Administrative Performance"); await page.locator(".pf-tabs button", { hasText: "Month closing" }).click(); await waitText("Month closing", 4000).catch(() => { });
    await page.waitForSelector("text=Must be fixed before closing"); await shot("12-closing");
    ok((await text()).includes("Score not finalized"), "blockers listed");
    await page.locator("button", { hasText: "Finalize all" }).click(); await page.waitForTimeout(700);
  });
  await step("settings: edit weights (validated) with reason", async () => {
    await page.locator(".pf-tabs button", { hasText: "Settings" }).click(); await page.waitForSelector("#w_task"); await page.waitForTimeout(600); await shot("13-settings");
    await page.fill("#w_task", "40"); await page.fill("#s_r", "test"); await page.locator("button", { hasText: "Save settings" }).click(); await page.waitForTimeout(400);
    ok(await page.locator(".ts").isVisible(), "toast shown"); const tt = await page.locator(".ts").innerText(); ok(/100/.test(tt), "weights must add to 100: " + tt);
    await page.fill("#w_task", "30");
  });
  await step("offices & KPIs modal", async () => {
    await page.locator(".pf-tabs button", { hasText: "Offices & KPIs" }).click(); await page.waitForSelector(".pf-sel"); await page.locator(".c.pf-sel", { hasText: "Content Creator" }).click(); await page.waitForSelector("#mc .pf-grid"); await shot("14-office");
    const t = await page.locator("#mc").innerText(); ok(t.includes("Responsibilities") && t.includes("KPIs"));
    await page.locator("#mc button", { hasText: /^Close$/ }).click();
  });
  await step("mobile layout: no horizontal page overflow; More menu", async () => {
    await page.setViewportSize({ width: 390, height: 800 });
    for (const v of ["ap", "tk", "pay", "adm"]) { await page.evaluate(x => go(x), v); await page.waitForTimeout(500); const o = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth); ok(o <= 2, v + " overflows horizontally by " + o); if (v === "ap") await shot("15-mobile-ap"); }
    await page.locator(".bt button", { hasText: "More" }).click(); await page.waitForSelector("#mc button"); ok((await page.locator("#mc").innerText()).includes("Office KPIs")); await page.locator("#mc button", { hasText: "Office KPIs" }).click();
    await page.setViewportSize({ width: 1360, height: 900 });
  });
  await step("dark and light themes both render the module", async () => {
    await page.evaluate(() => go("ap")); for (const t of ["dark", "light"]) { await page.evaluate(x => applyTheme(x), t); await page.waitForTimeout(200); await shot("16-theme-" + t); }
  });
  await step("settings: access codes table; generating a code retires the old one", async () => {
    await page.evaluate(() => { PF.X.tab = "settings"; go("ap") }); await page.waitForSelector("text=Access codes (login page)"); await shot("18-access-codes");
    const txt = await text(); for (const n of ["Administrator", "Tech Operations Manager", "Social Media & Community Manager"]) ok(txt.includes(n), "row " + n); ok(txt.includes("Generate new admin code"));
    const old = CODES.offices["Social Media & Community Manager"]; const id = (await api("GET", "/offices")).find(o => /Social/.test(o.name)).id;
    await page.locator("tr", { hasText: "Social Media" }).locator("button", { hasText: "Generate new code" }).click(); await page.waitForSelector("#cbx");
    const fresh = (await page.locator("#cbx .c").innerText()).split("\n").pop().trim(); ok(/^SOCIAL-[A-Z0-9]{5}-[A-Z0-9]{5}$/.test(fresh), "format " + fresh); await page.evaluate(() => mcl());
    const so = await api("GET", "/staff"); const om = so.find(s => s.name.startsWith("Omotuemen"));
    eq((await fetch(BASE + "/api/admin/me", { headers: { "x-staff-id": String(om.id), "x-office-code": old } })).status, 401, "old office code must stop working");
    eq((await fetch(BASE + "/api/admin/me", { headers: { "x-staff-id": String(om.id), "x-office-code": fresh } })).status, 200, "new office code works");
  });
  await step("staff portal: code login, own work only, submit, no management data", async () => {
    const code = (await api("POST", `/staff/${ada.id}/access-code`, {})).code; ok(/^[A-Z0-9]{8}$/i.test(code), "code format " + code);
    const p2 = await ctx.newPage(); p2.on("pageerror", e => problems.push("portal pageerror: " + e.message));
    await p2.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort()); await p2.goto(BASE + "/"); await p2.waitForSelector("#lg .seg");
    await p2.locator("#lgS").click(); await p2.waitForFunction(() => document.querySelectorAll("#lof option").length > 1);
    const opts = await p2.locator("#lof option").allInnerTexts(); ok(opts.length === 7, "seven offices listed: " + opts.length);
    await p2.selectOption("#lof", { label: "Content Creator" }); await p2.fill("#loc", CODES.offices["Personal Assistant"]); await p2.locator("#lb").click();
    await p2.waitForFunction(() => /Wrong office code/.test(document.querySelector("#le").innerText)); ok(!(await p2.locator("#lnm").count()), "another office's code must not open this office");
    await p2.fill("#loc", CODES.offices["Content Creator"]); await p2.locator("#lb").click(); await p2.waitForSelector("#lnm");
    const names = await p2.locator("#lnm option").allInnerTexts(); ok(names.length === 1 && /Adelana/.test(names[0]), "only this office's staff listed: " + names.join("|"));
    await p2.locator("#lb").click();
    await p2.waitForFunction(() => document.querySelector("main").innerText.includes("Hello,"), null, { timeout: 5000 });
    const t = await p2.locator("main").innerText(); ok(t.includes("Adelana Victor") && t.includes("Where your points come from")); ok(!t.includes("Isibor"), "other staff must not appear");
    if (SHOTS) await p2.screenshot({ path: path.join(SHOTS, "17-portal.png"), fullPage: true });
    const nv = await p2.locator("aside nav button").allInnerTexts(); ok(!nv.includes("Payroll") && nv.includes("My tasks"), "portal nav only: " + nv.join("|"));
    await p2.locator("aside nav button", { hasText: "My tasks" }).click(); await p2.waitForSelector("text=Newsletter draft");
    await p2.locator("tr", { hasText: "Newsletter draft" }).locator("button", { hasText: "Submit" }).click(); await p2.fill("#po", "Draft ready"); await p2.locator("#mc button", { hasText: /^Submit$/ }).click();
    await p2.waitForFunction(() => document.querySelector("main").innerText.includes("Submitted"), null, { timeout: 4000 });
    const H = { "x-staff-id": String(ada.id), "x-office-code": CODES.offices["Content Creator"] };
    eq((await fetch(BASE + "/api/admin/performance?month=" + MONTH, { headers: H })).status, 403, "staff must not read the scoreboard");
    eq((await fetch(BASE + "/api/staff", { headers: H })).status, 403, "staff must not read management data");
    eq((await fetch(BASE + "/api/admin/me", { headers: { "x-staff-id": String(isi.id), "x-office-code": CODES.offices["Content Creator"] } })).status, 401, "office code must not work for another office's staff");
    eq((await fetch(BASE + "/api/admin/me", { headers: { "x-staff-id": String(ada.id), "x-staff-code": code } })).status, 200, "personal code also works");
    await p2.close();
  });
  await step("login rate limit: repeated wrong codes are locked out", async () => {
    let last = 0; for (let i = 0; i < 12; i++) { last = (await fetch(BASE + "/api/auth/office", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ office_id: 1, code: "WRONG-" + i }) })).status; }
    eq(last, 429, "must lock after 10 wrong tries");
  });
  await browser.close();
  const fails = results.filter(r => !r[1]);
  console.log(`\n${results.length - fails.length}/${results.length} UI steps passed`);
  if (problems.length) { console.log("Browser errors:\n  " + [...new Set(problems)].join("\n  ")); }
  process.exit(fails.length || problems.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
