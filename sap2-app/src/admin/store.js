"use strict";
// Data access used by the admin modules. Only table/column names from schema.js are ever put into SQL.
// find/one/insert/update/upsert/remove/tx. Where values: scalar, null, array (IN), or {gte,lte,gt,lt,ne,in}.
const { ALL: T } = require("./schema");

const OPS = { gte: ">=", lte: "<=", gt: ">", lt: "<", ne: "<>" };
const isJsonCol = (tb, c) => /JSONB/i.test(T[tb].cols[c] || "");
const chkTable = (tb) => { if (!T[tb]) throw new Error(`Unknown table ${tb}`); };
const chkCol = (tb, c) => { if (!(c in T[tb].cols)) throw new Error(`Unknown column ${tb}.${c}`); };

function where(tb, w, params) {
  const parts = [];
  for (const [c, v] of Object.entries(w || {})) {
    chkCol(tb, c);
    const q = `"${c}"`;
    if (v === null) parts.push(`${q} IS NULL`);
    else if (Array.isArray(v)) { params.push(v); parts.push(`${q} = ANY($${params.length})`); }
    else if (typeof v === "object") {
      for (const [op, val] of Object.entries(v)) {
        if (op === "in") { params.push(val); parts.push(`${q} = ANY($${params.length})`); }
        else if (op === "ne" && val === null) parts.push(`${q} IS NOT NULL`);
        else if (OPS[op]) { params.push(val); parts.push(`${q} ${OPS[op]} $${params.length}`); }
        else throw new Error(`Bad operator ${op}`);
      }
    } else { params.push(v); parts.push(`${q} = $${params.length}`); }
  }
  return parts.length ? " WHERE " + parts.join(" AND ") : "";
}
const order = (tb, o) => (o && o.length ? " ORDER BY " + o.map(([c, d]) => { chkCol(tb, c); return `"${c}" ${d === "desc" ? "DESC" : "ASC"}`; }).join(", ") : "");
const val = (tb, c, v) => (isJsonCol(tb, c) && v !== null && v !== undefined ? JSON.stringify(v) : v);

// ---------------- Postgres ----------------
function pgStore(db, isTx = false, pool = null) {
  const run = async (text, params) => (await db.query(text, params)).rows;
  const s = {
    async find(tb, w = {}, o = {}) {
      chkTable(tb); const p = [];
      let sql = `SELECT * FROM ${tb}${where(tb, w, p)}${order(tb, o.order)}`;
      if (o.limit) { p.push(o.limit); sql += ` LIMIT $${p.length}`; }
      return run(sql, p);
    },
    async one(tb, w) { return (await s.find(tb, w, { limit: 1 }))[0] || null; },
    async insert(tb, row) {
      chkTable(tb); const cols = Object.keys(row); cols.forEach((c) => chkCol(tb, c));
      if (!cols.length) return (await run(`INSERT INTO ${tb} DEFAULT VALUES RETURNING *`, []))[0];
      const sql = `INSERT INTO ${tb} (${cols.map((c) => `"${c}"`).join(",")}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(",")}) RETURNING *`;
      return (await run(sql, cols.map((c) => val(tb, c, row[c]))))[0];
    },
    async update(tb, w, patch) {
      chkTable(tb); const cols = Object.keys(patch); if (!cols.length) return [];
      cols.forEach((c) => chkCol(tb, c));
      const p = cols.map((c) => val(tb, c, patch[c]));
      const sets = cols.map((c, i) => `"${c}" = $${i + 1}`).join(", ");
      return run(`UPDATE ${tb} SET ${sets}${where(tb, w, p)} RETURNING *`, p);
    },
    async upsert(tb, row, conflict) {
      chkTable(tb); const cols = Object.keys(row); cols.forEach((c) => chkCol(tb, c)); conflict.forEach((c) => chkCol(tb, c));
      const upd = cols.filter((c) => !conflict.includes(c));
      const sql = `INSERT INTO ${tb} (${cols.map((c) => `"${c}"`).join(",")}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(",")}) ON CONFLICT (${conflict.map((c) => `"${c}"`).join(",")}) ` +
        (upd.length ? `DO UPDATE SET ${upd.map((c) => `"${c}" = EXCLUDED."${c}"`).join(", ")}` : "DO NOTHING") + " RETURNING *";
      return (await run(sql, cols.map((c) => val(tb, c, row[c]))))[0];
    },
    async remove(tb, w) { chkTable(tb); const p = []; return (await db.query(`DELETE FROM ${tb}${where(tb, w, p)}`, p)).rowCount; },
    async raw(text, params = []) { return run(text, params); },
    async tx(fn) {
      if (isTx) return fn(s);
      const client = await pool.connect();
      try { await client.query("BEGIN"); const r = await fn(pgStore(client, true)); await client.query("COMMIT"); return r; }
      catch (e) { try { await client.query("ROLLBACK"); } catch (_) { /* ignore */ } throw e; }
      finally { client.release(); }
    },
  };
  return s;
}

// ---------------- In memory (tests) ----------------
const parseDefault = (sql) => {
  const m = /DEFAULT\s+('(?:[^']|'')*'(?:::\w+)?|TRUE|FALSE|-?\d+(?:\.\d+)?|now\(\))/i.exec(sql);
  if (!m) return { has: false };
  const t = m[1];
  if (/^true$/i.test(t)) return { has: true, v: () => true };
  if (/^false$/i.test(t)) return { has: true, v: () => false };
  if (/^now\(\)$/i.test(t)) return { has: true, v: () => new Date().toISOString() };
  if (/^-?\d/.test(t)) return { has: true, v: () => Number(t) };
  const txt = t.replace(/::\w+$/, "").slice(1, -1).replace(/''/g, "'");
  return { has: true, v: () => (/jsonb$/i.test(t) ? JSON.parse(txt) : txt) };
};

function memoryStore(extraTables = {}) {
  const defs = { ...T, ...extraTables }; // T already includes the existing staff/payments tables
  let data = {}; let seq = {};
  for (const k of Object.keys(defs)) { data[k] = []; seq[k] = 0; }
  const meta = (tb) => {
    const d = defs[tb]; if (!d) throw new Error(`Unknown table ${tb}`);
    if (!d._m) {
      d._m = {};
      for (const [c, sql] of Object.entries(d.cols)) {
        const checks = [...sql.matchAll(/CHECK\s*\(\s*(\w+)\s+IN\s*\(([^)]*)\)\s*\)/gi)].map((x) => ({ c: x[1], vals: x[2].split(",").map((v) => v.trim().replace(/^'|'$/g, "")) }));
        d._m[c] = { serial: /SERIAL/i.test(sql), pk: /PRIMARY KEY/i.test(sql), notNull: /NOT NULL|PRIMARY KEY/i.test(sql), def: parseDefault(sql), checks };
      }
    }
    return d;
  };
  const match = (row, w) => Object.entries(w || {}).every(([c, v]) => {
    const x = row[c];
    if (v === null) return x === null || x === undefined;
    if (Array.isArray(v)) return v.includes(x);
    if (typeof v === "object") return Object.entries(v).every(([op, y]) => {
      if (op === "in") return y.includes(x);
      if (op === "ne") return y === null ? x != null : x !== y;
      if (x === null || x === undefined) return false;
      return op === "gte" ? x >= y : op === "lte" ? x <= y : op === "gt" ? x > y : x < y;
    });
    return x === v;
  });
  const uniques = (tb) => { const d = meta(tb); const u = [...d.unique]; for (const [c, m] of Object.entries(d._m)) { if (m.pk && !m.serial) u.push([c]); if (/\bUNIQUE\b/i.test(d.cols[c]) && !/PRIMARY/i.test(d.cols[c])) u.push([c]); } if (d.pk) u.push(d.pk); return u; };
  const dupErr = (tb) => Object.assign(new Error(`duplicate key value violates unique constraint on ${tb}`), { code: "23505" });
  const validate = (tb, row) => {
    const d = meta(tb);
    for (const [c, m] of Object.entries(d._m)) {
      if (m.notNull && !m.serial && (row[c] === undefined || row[c] === null)) throw Object.assign(new Error(`null value in column "${c}" of ${tb}`), { code: "23502" });
      for (const ck of m.checks) if (row[ck.c] != null && !ck.vals.includes(String(row[ck.c]))) throw Object.assign(new Error(`check constraint failed on ${tb}.${ck.c}: ${row[ck.c]}`), { code: "23514" });
    }
  };
  const clone = (x) => JSON.parse(JSON.stringify(x));
  function build(st) {
    const s = {
      async find(tb, w = {}, o = {}) {
        meta(tb); Object.keys(w).forEach((c) => { if (!(c in defs[tb].cols)) throw new Error(`Unknown column ${tb}.${c}`); });
        let rows = st.data[tb].filter((r) => match(r, w));
        for (const [c, d] of [...(o.order || [])].reverse()) rows = [...rows].sort((a, b) => (a[c] > b[c] ? 1 : a[c] < b[c] ? -1 : 0) * (d === "desc" ? -1 : 1));
        if (o.limit) rows = rows.slice(0, o.limit);
        return clone(rows);
      },
      async one(tb, w) { return (await s.find(tb, w, { limit: 1 }))[0] || null; },
      async insert(tb, row) {
        const d = meta(tb); const r = {};
        for (const c of Object.keys(d.cols)) {
          const m = d._m[c];
          if (row[c] !== undefined) r[c] = row[c];
          else if (m.serial) r[c] = ++st.seq[tb];
          else if (m.def.has) r[c] = m.def.v();
          else r[c] = null;
        }
        for (const c of Object.keys(row)) if (!(c in d.cols)) throw new Error(`Unknown column ${tb}.${c}`);
        validate(tb, r);
        for (const u of uniques(tb)) if (st.data[tb].some((x) => u.every((c) => x[c] === r[c] && r[c] !== null))) throw dupErr(tb);
        st.data[tb].push(r); return clone(r);
      },
      async update(tb, w, patch) {
        meta(tb); const out = [];
        for (const r of st.data[tb]) if (match(r, w)) {
          const n = { ...r, ...patch }; validate(tb, n);
          for (const u of uniques(tb)) if (st.data[tb].some((x) => x !== r && u.every((c) => x[c] === n[c] && n[c] !== null))) throw dupErr(tb);
          Object.assign(r, patch); out.push(clone(r));
        }
        return out;
      },
      async upsert(tb, row, conflict) {
        const ex = st.data[tb].find((r) => conflict.every((c) => r[c] === row[c]));
        if (ex) { const patch = { ...row }; conflict.forEach((c) => delete patch[c]); return (await s.update(tb, Object.fromEntries(conflict.map((c) => [c, row[c]])), patch))[0]; }
        return s.insert(tb, row);
      },
      async remove(tb, w) { meta(tb); const before = st.data[tb].length; st.data[tb] = st.data[tb].filter((r) => !match(r, w)); return before - st.data[tb].length; },
      async raw() { throw new Error("raw SQL is not available in the in-memory store"); },
      async tx(fn) {
        const snap = clone({ data: st.data, seq: st.seq });
        try { return await fn(s); } catch (e) { st.data = snap.data; st.seq = snap.seq; throw e; }
      },
    };
    return s;
  }
  const st = { get data() { return data; }, set data(v) { data = v; }, get seq() { return seq; }, set seq(v) { seq = v; } };
  const store = build(st);
  store._dump = () => data;
  return store;
}

module.exports = { pgStore, memoryStore };
