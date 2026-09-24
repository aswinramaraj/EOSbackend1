require('dotenv').config({ path: 'C:/Users/shona/OneDrive/Documents/EOS1/EOSbackend1/.env' });
const { Client } = require('pg');

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();

  const q = async (label, sql, params) => {
    try {
      const res = await client.query(sql, params);
      console.log(`\n=== ${label} (${res.rowCount} rows) ===`);
      console.log(JSON.stringify(res.rows, null, 2));
    } catch (e) {
      console.log(`\n=== ${label} ERROR ===`);
      console.log(e.message);
    }
  };

  await q('students table columns', `select column_name from information_schema.columns where table_name='students' order by ordinal_position`);
  await q('students in class 1121', `select id from students where class_id=1121 order by id`);
  await q('attendance sample row for class 1121 (mentor-marked)', `select * from attendance_records where class_id=1121 order by attendance_date desc limit 3`);
  await q('subjects 1686', `select * from subjects where id=1686`);
  await q('subjects 1699,1700,1701,1702,1703,1704', `select id, name, code from subjects where id in (1699,1700,1701,1702,1703,1704)`);
  await q('appraisal_criteria all', `select * from appraisal_criteria order by division_id, id`);
  await q('appraisal_cycles current', `select * from appraisal_cycles order by id desc limit 5`);
  await q('appraisal_requests full sample with entries for pattern', `select * from appraisal_requests where id=91`);
  await q('appraisal_entries for request 91', `select * from appraisal_entries where appraisal_request_id=91`);
  await q('departments 75', `select * from departments where id=75`);
  await q('faculty 3503 (reports_to)', `select id, first_name, last_name, designation from faculty where id=3503`);
  await q('salary_divisions sample', `select * from salary_divisions limit 5`);
  await q('faculty_leave_balances for 3539', `select * from faculty_leave_balances where faculty_id=3539`);
  await q('max ids for tables I will insert into', `select
    (select max(id) from faculty_leaves) as faculty_leaves_max,
    (select max(id) from faculty_od_requests) as faculty_od_max,
    (select max(id) from payslip_requests) as payslip_max,
    (select max(id) from appraisal_requests) as appraisal_req_max,
    (select max(id) from appraisal_entries) as appraisal_entries_max,
    (select max(id) from lesson_plans) as lesson_plans_max,
    (select max(id) from lesson_plan_sessions) as lesson_plan_sessions_max,
    (select max(id) from wallet_transactions) as wallet_txn_max,
    (select max(id) from attendance_records) as attendance_max
  `);

  await client.end();
}

main().catch(e => { console.error(e); process.exit(1); });
