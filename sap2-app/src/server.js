require("dotenv").config();
const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const path = require("path");
const { pool, query } = require("./db");

const app = express();
// No login, so only allow pages served from this computer (blocks other websites from reading the data).
app.use(
  cors({
    origin: (o, cb) =>
      cb(null, !o || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(o)),
  }),
);
app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public"))); // serves the SAP2 frontend

const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);
const isMonth = (m) => /^\d{4}-(0[1-9]|1[0-2])$/.test(m || "");
const isDate = (d) =>
  /^\d{4}-\d{2}-\d{2}$/.test(d || "") && !isNaN(new Date(d));
const mask = (a) => (a ? "****" + String(a).slice(-4) : a);
const currentMonth = () => new Date().toISOString().slice(0, 7);

// ---- health (no auth) ----
// Online (Netlify) copies must have API_KEY set; running on your own computer needs no login.
const hosted = !!(process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.NETLIFY);
app.get(
  "/api/health",
  wrap(async (_req, res) => {
    const { rows } = await query(
      "select current_database() as db, now() as time",
    );
    res.json({
      ok: true,
      ...rows[0],
      auth: !!process.env.API_KEY,
      misconfigured: hosted && !process.env.API_KEY,
    });
  }),
);

// ---- optional API-key login (required automatically when hosted online) ----
const fails = new Map();
const clientIp = (req) =>
  req.get("x-nf-client-connection-ip") ||
  (req.get("x-forwarded-for") || "").split(",")[0].trim() ||
  req.ip;
app.use("/api", (req, res, next) => {
  const key = process.env.API_KEY;
  if (!key) {
    if (hosted)
      return res
        .status(503)
        .json({
          error:
            "This online copy has no API_KEY set, so it is locked. Add API_KEY in the hosting settings.",
        });
    return next(); // local use: no login
  }
  const ip = clientIp(req),
    now = Date.now();
  const f = fails.get(ip) || { n: 0, t: now };
  if (now - f.t > 15 * 60 * 1000) {
    f.n = 0;
    f.t = now;
  }
  if (f.n >= 10)
    return res
      .status(429)
      .json({ error: "Too many wrong keys. Try again in 15 minutes." });
  const given = Buffer.from(req.get("x-api-key") || "");
  const want = Buffer.from(key);
  if (given.length !== want.length || !crypto.timingSafeEqual(given, want)) {
    f.n++;
    fails.set(ip, f);
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
});

// ---- staff ----
app.get(
  "/api/staff",
  wrap(async (req, res) => {
    const { type, active, q } = req.query;
    const where = [];
    const p = [];
    if (type === "instructor")
      where.push(`staff_type IN ('instructor','both')`);
    if (type === "admin") where.push(`staff_type IN ('admin','both')`);
    if (active === "true" || active === "false") {
      p.push(active === "true");
      where.push(`active = $${p.length}`);
    }
    if (q) {
      p.push(`%${q}%`);
      where.push(
        `(name ILIKE $${p.length} OR phone ILIKE $${p.length} OR role ILIKE $${p.length})`,
      );
    }
    const { rows } = await query(
      `SELECT *, length(account_number) AS account_len, length(phone) AS phone_len FROM staff ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY name`,
      p,
    );
    res.json(
      rows.map((r) => ({ ...r, account_number: mask(r.account_number) })),
    );
  }),
);

app.get(
  "/api/staff/:id",
  wrap(async (req, res) => {
    const { rows } = await query("SELECT * FROM staff WHERE id=$1", [
      req.params.id,
    ]);
    if (!rows[0]) return res.status(404).json({ error: "Not found" });
    const s = rows[0];
    if (req.query.reveal !== "true") s.account_number = mask(s.account_number);
    res.json(s);
  }),
);

app.post(
  "/api/staff",
  wrap(async (req, res) => {
    const b = req.body;
    if (!b.name || !["instructor", "admin", "both"].includes(b.staff_type))
      return res
        .status(400)
        .json({
          error: "name and staff_type (instructor|admin|both) are required",
        });
    const { rows } = await query(
      `INSERT INTO staff (name,email,phone,bank,account_number,staff_type,role,campuses,skills,frequency,per_appearance_rate,monthly_salary)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,COALESCE($11,20000),$12) RETURNING *`,
      [
        b.name,
        b.email,
        b.phone,
        b.bank,
        b.account_number,
        b.staff_type,
        b.role || "Instructor",
        b.campuses || [],
        b.skills || [],
        b.frequency,
        b.per_appearance_rate,
        b.monthly_salary,
      ],
    );
    res
      .status(201)
      .json({ ...rows[0], account_number: mask(rows[0].account_number) });
  }),
);

app.patch(
  "/api/staff/:id",
  wrap(async (req, res) => {
    const allowed = [
      "email",
      "phone",
      "bank",
      "account_number",
      "role",
      "campuses",
      "skills",
      "frequency",
      "per_appearance_rate",
      "monthly_salary",
      "active",
    ];
    const sets = [];
    const p = [];
    for (const k of allowed)
      if (k in req.body) {
        p.push(req.body[k]);
        sets.push(`${k}=$${p.length}`);
      }
    if (!sets.length)
      return res.status(400).json({ error: "No editable fields supplied" });
    p.push(req.params.id);
    const { rows } = await query(
      `UPDATE staff SET ${sets.join(",")} WHERE id=$${p.length} RETURNING *`,
      p,
    );
    if (!rows[0]) return res.status(404).json({ error: "Not found" });
    res.json({ ...rows[0], account_number: mask(rows[0].account_number) });
  }),
);

// ---- appearances ----
app.get(
  "/api/appearances",
  wrap(async (req, res) => {
    const { month, from, to, staff_id } = req.query;
    const where = [];
    const p = [];
    if (month) {
      if (!isMonth(month))
        return res.status(400).json({ error: "month must be YYYY-MM" });
      p.push(month);
      where.push(`to_char(a.date,'YYYY-MM')=$${p.length}`);
    }
    if (from) {
      p.push(from);
      where.push(`a.date >= $${p.length}`);
    }
    if (to) {
      p.push(to);
      where.push(`a.date <= $${p.length}`);
    }
    if (staff_id) {
      p.push(staff_id);
      where.push(`a.staff_id = $${p.length}`);
    }
    const { rows } = await query(
      `SELECT a.id, a.staff_id, s.name, to_char(a.date,'YYYY-MM-DD') AS date, a.campus, a.rate, a.recorded_by, a.recorded_at
     FROM appearances a JOIN staff s ON s.id=a.staff_id
     ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY a.date DESC, s.name`,
      p,
    );
    res.json(rows);
  }),
);

app.post(
  "/api/appearances",
  wrap(async (req, res) => {
    const { staff_id, date, campus, recorded_by } = req.body;
    if (!staff_id || !isDate(date) || !campus)
      return res
        .status(400)
        .json({ error: "staff_id, date (YYYY-MM-DD) and campus are required" });
    const s = (
      await query(
        `SELECT per_appearance_rate, staff_type, campuses, active FROM staff WHERE id=$1`,
        [staff_id],
      )
    ).rows[0];
    if (!s) return res.status(404).json({ error: "Staff not found" });
    if (s.staff_type === "admin")
      return res
        .status(400)
        .json({
          error:
            "Administrative-only staff are paid by salary, not appearances",
        });
    if (!s.active)
      return res.status(400).json({ error: "Staff member is inactive" });
    try {
      const { rows } = await query(
        `INSERT INTO appearances (staff_id,date,campus,rate,recorded_by) VALUES ($1,$2,$3,$4,$5)
       RETURNING id, staff_id, to_char(date,'YYYY-MM-DD') AS date, campus, rate, recorded_by, recorded_at`,
        [staff_id, date, campus, s.per_appearance_rate, recorded_by || null],
      );
      res.status(201).json(rows[0]);
    } catch (e) {
      if (e.code === "23505")
        return res
          .status(409)
          .json({
            error:
              "Appearance already recorded for this staff, date and campus",
          });
      throw e;
    }
  }),
);

app.delete(
  "/api/appearances/:id",
  wrap(async (req, res) => {
    const { rowCount } = await query("DELETE FROM appearances WHERE id=$1", [
      req.params.id,
    ]);
    if (!rowCount) return res.status(404).json({ error: "Not found" });
    res.json({ deleted: true });
  }),
);

// ---- payroll ----
async function payrollRows(month) {
  const { rows } = await query(
    `SELECT s.id AS staff_id, s.name, s.role, s.staff_type, s.per_appearance_rate, s.monthly_salary,
            COALESCE(ap.n,0)::int AS appearances, COALESCE(ap.total,0)::int AS appearance_pay
     FROM staff s
     LEFT JOIN (SELECT staff_id, count(*) n, sum(rate) total FROM appearances
                WHERE to_char(date,'YYYY-MM')=$1 GROUP BY staff_id) ap ON ap.staff_id=s.id
     WHERE s.active ORDER BY s.name`,
    [month],
  );
  const bon = (
    await query(
      `SELECT staff_id, pay_type, amount FROM bonuses WHERE month=$1`,
      [month],
    )
  ).rows;
  const paid = (
    await query(
      `SELECT staff_id, pay_type, reference, amount, paid_at FROM payments WHERE month=$1`,
      [month],
    )
  ).rows;
  const out = [];
  const push = (r, pay_type, base, extra) => {
    const bonus =
      bon.find((b) => b.staff_id === r.staff_id && b.pay_type === pay_type)
        ?.amount || 0;
    const pay = paid.find(
      (x) => x.staff_id === r.staff_id && x.pay_type === pay_type,
    );
    out.push({
      staff_id: r.staff_id,
      name: r.name,
      pay_type,
      base,
      bonus,
      amount: base + bonus,
      status: pay ? "Paid" : base + bonus > 0 ? "Pending" : "No amount",
      reference: pay?.reference || null,
      ...extra,
    });
  };
  for (const r of rows) {
    if (r.staff_type !== "admin")
      push(r, "instructor", r.appearance_pay, {
        appearances: r.appearances,
        rate: r.per_appearance_rate,
      });
    if (r.staff_type !== "instructor")
      push(r, "admin", r.monthly_salary || 0, {
        role: r.role,
        salary_missing: r.monthly_salary == null,
      });
  }
  return out;
}

app.get(
  "/api/payroll",
  wrap(async (req, res) => {
    const month = req.query.month || currentMonth();
    if (!isMonth(month))
      return res.status(400).json({ error: "month must be YYYY-MM" });
    const rows = await payrollRows(month);
    const sum = (f) => rows.filter(f).reduce((a, r) => a + r.amount, 0);
    const totals = {
      instructor: sum((r) => r.pay_type === "instructor"),
      admin: sum((r) => r.pay_type === "admin"),
      total: sum(() => true),
      paid: sum((r) => r.status === "Paid"),
    };
    totals.pending = totals.total - totals.paid;
    res.json({ month, totals, rows });
  }),
);

app.put(
  "/api/bonuses",
  wrap(async (req, res) => {
    const { staff_id, pay_type, month, amount } = req.body;
    if (
      !staff_id ||
      !["instructor", "admin"].includes(pay_type) ||
      !isMonth(month)
    )
      return res
        .status(400)
        .json({
          error:
            "staff_id, pay_type (instructor|admin) and month (YYYY-MM) are required",
        });
    if (
      (
        await query(
          "SELECT 1 FROM payments WHERE staff_id=$1 AND pay_type=$2 AND month=$3",
          [staff_id, pay_type, month],
        )
      ).rowCount
    )
      return res.status(409).json({ error: "Already paid; bonus is locked" });
    const n = Math.max(0, Math.round(Number(amount) || 0));
    if (n === 0)
      await query(
        "DELETE FROM bonuses WHERE staff_id=$1 AND pay_type=$2 AND month=$3",
        [staff_id, pay_type, month],
      );
    else
      await query(
        `INSERT INTO bonuses (staff_id,pay_type,month,amount) VALUES ($1,$2,$3,$4)
                    ON CONFLICT (staff_id,pay_type,month) DO UPDATE SET amount=EXCLUDED.amount`,
        [staff_id, pay_type, month, n],
      );
    res.json({ staff_id, pay_type, month, amount: n });
  }),
);

app.post(
  "/api/payroll/pay",
  wrap(async (req, res) => {
    const { month, items } = req.body;
    if (!isMonth(month) || !Array.isArray(items) || !items.length)
      return res
        .status(400)
        .json({
          error:
            "month and a non-empty items[{staff_id,pay_type}] are required",
        });
    const rows = await payrollRows(month);
    const client = await pool.connect();
    const done = [];
    try {
      await client.query("BEGIN");
      for (const it of items) {
        const r = rows.find(
          (x) =>
            x.staff_id === Number(it.staff_id) && x.pay_type === it.pay_type,
        );
        if (!r || r.status !== "Pending") continue; // skip unknown, already paid, or zero
        const ref = `SAP2-${month.replace("-", "")}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
        await client.query(
          `INSERT INTO payments (staff_id,pay_type,month,amount,reference) VALUES ($1,$2,$3,$4,$5)`,
          [r.staff_id, r.pay_type, month, r.amount, ref],
        );
        done.push({
          staff_id: r.staff_id,
          name: r.name,
          pay_type: r.pay_type,
          amount: r.amount,
          reference: ref,
        });
      }
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
    res.json({
      month,
      processed: done.length,
      total: done.reduce((a, d) => a + d.amount, 0),
      payments: done,
    });
  }),
);

app.get(
  "/api/payments",
  wrap(async (_req, res) => {
    const { rows } = await query(
      `SELECT p.id, s.name, p.pay_type, p.month, p.amount, p.reference, p.paid_at
     FROM payments p JOIN staff s ON s.id=p.staff_id ORDER BY p.paid_at DESC`,
    );
    res.json(rows);
  }),
);

// ---- dashboard ----
app.get(
  "/api/dashboard",
  wrap(async (req, res) => {
    const month = req.query.month || currentMonth();
    const today = new Date().toISOString().slice(0, 10);
    const counts = (
      await query(`SELECT
      count(*) FILTER (WHERE active)::int AS total_staff,
      count(*) FILTER (WHERE active AND staff_type IN ('instructor','both'))::int AS instructors,
      count(*) FILTER (WHERE active AND staff_type IN ('admin','both'))::int AS administrative FROM staff`)
    ).rows[0];
    const todayN = (
      await query("SELECT count(*)::int n FROM appearances WHERE date=$1", [
        today,
      ])
    ).rows[0].n;
    const rows = await payrollRows(month);
    const total = rows.reduce((a, r) => a + r.amount, 0);
    const paid = rows
      .filter((r) => r.status === "Paid")
      .reduce((a, r) => a + r.amount, 0);
    res.json({
      month,
      ...counts,
      todays_appearances: todayN,
      total_payroll: total,
      paid,
      pending: total - paid,
    });
  }),
);

// ---- unknown API routes: clear JSON instead of an HTML 404 ----
app.use("/api", (req, res) =>
  res
    .status(404)
    .json({ error: `No such API route: ${req.method} ${req.originalUrl}` }),
);

// ---- errors ----
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

const port = process.env.PORT || 3000;
const host = process.env.SAP2_HOST || "0.0.0.0";

if (require.main === module)
  app.listen(port, host, () =>
    console.log(`SAP2 is running on ${host}:${port}`),
  );
module.exports = app;
