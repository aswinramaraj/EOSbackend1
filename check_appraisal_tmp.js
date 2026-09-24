require('dotenv').config();
const { Client } = require('pg');
(async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 8000 });
  await client.connect();
  const cycles = await client.query(`SELECT id, academic_year, start_date, end_date, is_active FROM appraisal_cycles ORDER BY id DESC LIMIT 5`);
  console.log("cycles:", cycles.rows);
  const divisions = await client.query(`SELECT id, name FROM appraisal_divisions ORDER BY id`);
  console.log("divisions:", divisions.rows);
  const criteria = await client.query(`SELECT id, division_id, criteria_name, max_score, academic_year, status FROM appraisal_criteria ORDER BY division_id, id LIMIT 20`);
  console.log("criteria:", criteria.rows);
  const leaveTypes = await client.query(`SELECT id, name, default_annual_quota, is_active FROM leave_types ORDER BY id`);
  console.log("leave_types:", leaveTypes.rows);
  await client.end();
})().catch(e => { console.error(e.message); process.exit(1); });
