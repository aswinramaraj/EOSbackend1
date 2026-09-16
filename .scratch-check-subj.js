require('dotenv').config();
const { Client } = require('pg');
(async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const r = await client.query(`SELECT id, student_id, class_id, subject_id, attendance_date, status, marked_by_faculty_id, marked_by_user_id FROM attendance_records WHERE class_id = 1121 AND marked_by_user_id = 38548 LIMIT 5`);
  console.log(JSON.stringify(r.rows, null, 1));
  // also check payslip_requests file_url convention for HoD's processed one
  const r2 = await client.query(`SELECT id, faculty_id, month, year, status, file_url FROM payslip_requests WHERE status = 'processed' AND file_url IS NOT NULL LIMIT 3`);
  console.log('PAYSLIP FILE_URL SAMPLES', JSON.stringify(r2.rows, null, 1));
  await client.end();
})().catch(e => { console.error(e); process.exit(1); });
