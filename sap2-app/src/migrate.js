const fs = require('fs');
const path = require('path');
const { pool } = require('./db');
const { ensureSchema } = require('./admin/migrate');

(async () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');
  await pool.query(sql);
  const { rows } = await pool.query('select current_database() as db');
  console.log(`Schema applied to database "${rows[0].db}".`);
  const r = await ensureSchema(pool, { force: true });
  console.log(r.changed ? 'Administrative performance tables are ready.' : 'Administrative performance tables already up to date.');
  if (r.needs_office && r.needs_office.length) console.log('Needs an office assigned in the app: ' + r.needs_office.join(', '));
  await pool.end();
})().catch((e) => { console.error(e.message); process.exit(1); });
