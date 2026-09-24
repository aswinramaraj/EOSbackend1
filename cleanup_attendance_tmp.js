require('dotenv').config();
const { Client } = require('pg');
(async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10000 });
  await client.connect();
  const r = await client.query(`DELETE FROM faculty_daily_attendance WHERE staff_user_id = 25 AND attendance_date = '2026-08-21' RETURNING id`);
  console.log('faculty_daily_attendance deleted:', r.rows);
  await client.end();
})().catch(e => { console.error(e.message); process.exit(1); });
