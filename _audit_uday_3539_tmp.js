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

  // 0. verify class mentor / subject mapping
  await q('class_mentors for class 1121', `select * from class_mentors where class_id=1121`);
  await q('faculty_subject_class_mapping for faculty 3539', `select * from faculty_subject_class_mapping where faculty_id=3539`);
  await q('faculty_subject_class_mapping for class 1121 (any faculty)', `select * from faculty_subject_class_mapping where class_id=1121`);
  await q('classes row 1121', `select * from classes where id=1121`);

  // 1. attendance
  await q('attendance_records marked_by_user_id=38548 count/recent', `select class_id, attendance_date, count(*), max(attendance_date) as latest from attendance_records where marked_by_user_id=38548 group by class_id, attendance_date order by attendance_date desc limit 10`);
  await q('attendance_records marked_by_faculty_id=3539 count', `select count(*), max(attendance_date) from attendance_records where marked_by_faculty_id=3539`);
  await q('attendance sample row', `select * from attendance_records where marked_by_faculty_id=3539 order by attendance_date desc limit 2`);
  await q('roster of class 1121 (students)', `select id, first_name, last_name from students where class_id=1121 limit 100`);

  // 2. LMS
  await q('assignments by faculty 3539', `select * from assignments where faculty_id=3539`);
  await q('student_assignment_status needing grading for faculty assignments', `select sas.* from student_assignment_status sas join assignments a on a.id=sas.assignment_id where a.faculty_id=3539 limit 20`);
  await q('lms_folders faculty 3539', `select * from lms_folders where faculty_id=3539`);
  await q('lesson_plans faculty 3539', `select * from lesson_plans where faculty_id=3539`);
  await q('lesson_plan_sessions for those plans', `select lps.* from lesson_plan_sessions lps join lesson_plans lp on lp.id=lps.lesson_plan_id where lp.faculty_id=3539`);

  // 3. faculty leaves
  await q('faculty_leaves for 3539', `select * from faculty_leaves where faculty_id=3539`);
  await q('faculty_leaves sample (any)', `select * from faculty_leaves order by id desc limit 2`);
  await q('leave_types', `select * from leave_types limit 20`);

  // 4. OD
  await q('faculty_od_requests for 3539', `select * from faculty_od_requests where faculty_id=3539`);
  await q('faculty_od_requests sample (any)', `select * from faculty_od_requests order by id desc limit 2`);

  // 5. payslip
  await q('payslip_requests for faculty 3539', `select * from payslip_requests where faculty_id=3539`);
  await q('payslip_requests sample (any)', `select * from payslip_requests order by id desc limit 2`);

  // 6. appraisal
  await q('appraisal_requests for faculty 3539', `select * from appraisal_requests where faculty_id=3539`);
  await q('appraisal_requests sample (any)', `select * from appraisal_requests order by id desc limit 2`);
  await q('appraisal_criteria sample', `select * from appraisal_criteria limit 5`);
  await q('appraisal_divisions', `select * from appraisal_divisions limit 10`);
  await q('appraisal_entries sample', `select * from appraisal_entries limit 2`);

  // 7. faculty profile completeness
  await q('faculty row 3539', `select * from faculty where id=3539`);
  await q('faculty_sensitive_info for 3539', `select * from faculty_sensitive_info where faculty_id=3539`);
  await q('faculty_documents for 3539', `select * from faculty_documents where faculty_id=3539`);

  // 8. wallet
  await q('wallets for user 38548', `select * from wallets where user_id=38548`);
  await q('wallet_transactions for that wallet', `select wt.* from wallet_transactions wt join wallets w on w.id=wt.wallet_id where w.user_id=38548`);
  await q('wallet sample any (for enum ref)', `select * from wallet_transactions order by id desc limit 2`);

  // 9. messaging
  await q('message_participants for user 38548', `select * from message_participants where user_id=38548`);
  await q('message_conversations sample', `select * from message_conversations order by id desc limit 2`);
  await q('messages sample', `select * from messages order by id desc limit 2`);

  await client.end();
}

main().catch(e => { console.error(e); process.exit(1); });
