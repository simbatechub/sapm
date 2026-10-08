require('dotenv').config();
const { Pool, types } = require('pg');
types.setTypeParser(1082, (v) => v); // DATE columns come back as 'YYYY-MM-DD' text (no timezone shifts)
types.setTypeParser(1700, (v) => parseFloat(v)); // NUMERIC columns come back as numbers

// Accept a pasted "psql '...'" command or quoted value too: pull out the postgresql:// URL.
const match = (process.env.DATABASE_URL || '').match(/postgres(?:ql)?:\/\/[^\s'"]+/);
const DATABASE_URL = match && match[0];
if (!DATABASE_URL) {
  console.error('DATABASE_URL is missing or not a valid connection string (it must start with postgresql://). Fix it in the .env file.');
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: true }, // Neon requires TLS
  max: process.env.AWS_LAMBDA_FUNCTION_NAME ? 2 : 5, // small pool when running as a serverless function
});

module.exports = { pool, query: (text, params) => pool.query(text, params) };
