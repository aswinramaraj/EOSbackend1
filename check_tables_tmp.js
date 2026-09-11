require('dotenv').config();
const { Client } = require('pg');
(async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 8000 });
  await client.connect();
  const check = await client.query(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema='public' AND table_name IN (
      'media_staff_attendance','media_leave_types','media_leave_requests','media_od_requests',
      'media_payslip_requests','media_appraisal_divisions','media_appraisal_criteria',
      'media_appraisal_requests','media_appraisal_entries','media_room_library_loans'
    ) ORDER BY table_name;
  `);
  console.log("existing:", check.rows.map(r => r.table_name));
  await client.end();
})().catch(e => { console.error(e.message); process.exit(1); });
