"use strict";
// Safe, repeatable setup of the administrative-performance tables + first-time defaults.
// Never drops or rewrites existing data. Runs automatically when the server starts (and via `npm run migrate`).
const { ddl, SCHEMA_VERSION } = require("./schema");
const { OFFICES, TITLE_MAP } = require("./defaults");
const { pgStore } = require("./store");
const fs = require("fs"), path = require("path");

const norm = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");

// Works with any store (Postgres or the in-memory test store). Idempotent: only fills what is missing.
async function seedDefaults(store) {
  const summary = { offices_created: 0, mapped: [], needs_office: [] };
  for (let i = 0; i < OFFICES.length; i++) {
    const o = OFFICES[i];
    if (await store.one("administrative_offices", { code: o.code })) continue; // management may have edited it: never overwrite
    const row = await store.insert("administrative_offices", { code: o.code, name: o.name, short_name: o.short, purpose: o.purpose, sort_order: i + 1 });
    let p = 0; for (const t of o.responsibilities) await store.insert("office_responsibilities", { office_id: row.id, position: ++p, text: t });
    for (const [name, type, target, auto, weight, freq] of o.kpis)
      await store.insert("office_kpis", { office_id: row.id, name, measurement_type: type, target, auto_source: auto, weight, frequency: freq, description: auto ? "Calculated automatically from SAP2 data unless management enters a result." : type === "QUALITY" || type === "RATING_10" ? "Management rating from 1 to 10. The target is the rating that earns full marks." : "Management enters the actual result each month." });
    summary.offices_created++;
  }
  for (const [pattern, office_code, suggested] of TITLE_MAP)
    if (!(await store.one("office_title_map", { pattern }))) await store.insert("office_title_map", { pattern, office_code, suggested: !!suggested });
  const offices = new Map((await store.find("administrative_offices")).map((o) => [o.code, o]));
  const map = await store.find("office_title_map");
  for (const s of await store.find("staff", { staff_type: ["admin", "both"], office_id: null })) {
    const hit = map.find((m) => m.pattern === norm(s.role) && !m.suggested);
    const office = hit && offices.get(hit.office_code);
    if (office) { await store.update("staff", { id: s.id }, { office_id: office.id }); summary.mapped.push(`${s.name} -> ${office.name}`); }
    else summary.needs_office.push(`${s.name} (${s.role})`);
  }
  summary.access_codes_created = await seedAccessCodes(store, offices);
  return summary;
}

// First-time login codes. data/access-seed.json holds only salted hashes (never the codes), so shipping it is safe.
// Codes that already exist are never replaced (management may have generated new ones).
async function seedAccessCodes(store, offices) {
  let file; try { file = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "data", "access-seed.json"), "utf8")); } catch (e) { return 0; }
  let n = 0;
  for (const c of file.codes || []) {
    if (await store.one("access_codes", { key: c.key })) continue;
    const office = c.scope === "OFFICE" ? offices.get(c.key.slice("OFFICE:".length)) : null;
    if (c.scope === "OFFICE" && !office) continue;
    await store.insert("access_codes", { key: c.key, scope: c.scope, office_id: office ? office.id : null, code_salt: c.salt, code_hash: c.hash, created_by: "initial setup" }); n++;
  }
  return n;
}

async function ensureSchema(pool, { force = false } = {}) {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(727301)"); // two servers starting at once must not run the migration together
    const reg = (await client.query("SELECT to_regclass('public.performance_settings') AS t")).rows[0].t;
    let version = 0;
    if (reg) { const r = await client.query("SELECT value FROM performance_settings WHERE key = 'schema_version'"); version = r.rows[0] ? Number(r.rows[0].value) : 0; }
    if (version >= SCHEMA_VERSION && !force) return { changed: false };
    await client.query("BEGIN");
    try {
      await client.query(ddl());
      const summary = await seedDefaults(pgStore(client, true));
      await client.query("INSERT INTO performance_settings (key, value, updated_by) VALUES ('schema_version', $1::jsonb, 'migration') ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [JSON.stringify(SCHEMA_VERSION)]);
      await client.query("COMMIT");
      return { changed: true, ...summary };
    } catch (e) { await client.query("ROLLBACK"); throw e; }
  } finally {
    try { await client.query("SELECT pg_advisory_unlock(727301)"); } catch (_) { /* connection may be gone */ }
    client.release();
  }
}

module.exports = { ensureSchema, seedDefaults, seedAccessCodes, norm };
