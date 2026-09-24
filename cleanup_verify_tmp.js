require('dotenv').config();
const { Client } = require('pg');
(async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10000 });
  await client.connect();

  const leave = await client.query(`DELETE FROM faculty_leaves WHERE id = 44 AND reason = 'Verification test' RETURNING id`);
  console.log('faculty_leaves deleted:', leave.rows);

  const od = await client.query(`DELETE FROM faculty_od_requests WHERE id = 17 AND purpose = 'Verification test' RETURNING id`);
  console.log('faculty_od_requests deleted:', od.rows);

  const payslip = await client.query(`DELETE FROM payslip_requests WHERE id = 10 AND purpose = 'Verification test' RETURNING id`);
  console.log('payslip_requests deleted:', payslip.rows);

  const appraisal = await client.query(`DELETE FROM appraisal_requests WHERE id = 23 AND academic_year = '2025-2026' RETURNING id`);
  console.log('appraisal_requests deleted (entries cascade):', appraisal.rows);

  await client.end();
})().catch(e => { console.error(e.message); process.exit(1); });
