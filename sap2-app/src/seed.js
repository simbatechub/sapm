const path = require('path');
const { pool } = require('./db');
const staff = require(path.join('..', 'data', 'seed.json'));

(async () => {
  for (const s of staff) {
    await pool.query(
      `INSERT INTO staff (name,email,phone,bank,account_number,staff_type,role,campuses,skills,frequency,monthly_salary)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (name) DO NOTHING`,
      [s.name, s.email, s.phone, s.bank, s.account_number, s.staff_type, s.role,
       s.campuses, s.skills, s.frequency, s.monthly_salary]
    );
  }
  const { rows } = await pool.query('select count(*)::int as n from staff');
  console.log(`Seed complete. staff rows: ${rows[0].n}`);
  await pool.end();
})().catch((e) => { console.error(e.message); process.exit(1); });
