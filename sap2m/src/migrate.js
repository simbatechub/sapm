const fs = require('fs');
const path = require('path');
const { pool } = require('./db');

(async () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');
  await pool.query(sql);
  const { rows } = await pool.query('select current_database() as db');
  console.log(`Schema applied to database "${rows[0].db}".`);
  await pool.end();
})().catch((e) => { console.error(e.message); process.exit(1); });
