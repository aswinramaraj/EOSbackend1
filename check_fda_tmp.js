require('dotenv').config();
const { Client } = require('pg');
(async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10000 });
  await client.connect();
  const r = await client.query(`SELECT DISTINCT academic_year FROM faculty_daily_attendance ORDER BY academic_year DESC LIMIT 5`);
  console.log("academic_year values:", r.rows);
  const sample = await client.query(`SELECT id, faculty_id, staff_user_id, attendance_date, status, academic_year, punch_in, punch_out FROM faculty_daily_attendance ORDER BY attendance_date DESC LIMIT 5`);
  console.log("sample rows:", sample.rows);
  await client.end();
})().catch(e => { console.error(e.message); process.exit(1); });
