require('dotenv').config();
const { Client } = require('pg');
(async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const r = await client.query(`SELECT * FROM attendance_records WHERE student_id = 20884 ORDER BY attendance_date`);
  console.log('EXISTING DINESH ATTENDANCE', JSON.stringify(r.rows, null, 1));
  // check how many rows per day typically for another student in same class (multi-subject?)
  const r2 = await client.query(`SELECT student_id, attendance_date, count(*) FROM attendance_records WHERE class_id = 1233 GROUP BY student_id, attendance_date ORDER BY attendance_date DESC LIMIT 10`);
  console.log('ROWS PER DAY PER STUDENT (class 1233)', JSON.stringify(r2.rows));
  // academic calendar holiday events for this batch, march-sept 2026
  const r3 = await client.query(`SELECT column_name FROM information_schema.columns WHERE table_name='academic_calendars'`);
  console.log('academic_calendars columns', JSON.stringify(r3.rows));
  const r4 = await client.query(`SELECT * FROM academic_calendars WHERE batch_id = 54`);
  console.log('academic_calendars rows for batch 54', JSON.stringify(r4.rows, null, 1));
  await client.end();
})().catch(e => { console.error(e); process.exit(1); });
