const { Client } = require('pg');
require('dotenv').config({ path: 'C:/Users/shona/OneDrive/Documents/EOS1/EOSbackend1/.env' });

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  async function q(label, sql) {
    try {
      const res = await client.query(sql);
      console.log(`\n=== ${label} (${res.rowCount} rows) ===`);
      console.log(JSON.stringify(res.rows, null, 2));
    } catch (e) {
      console.log(`\n=== ${label} ERROR ===`);
      console.log(e.message);
    }
  }

  // Basic identity confirm
  await q('user 38512', `select id, email, role_id from users where id=38512`);
  await q('faculty 3503', `select id, name, department_id, user_id from faculty where id=3503`);

  // 1. Student leaves pending hod, dept 75
  await q('student_leaves pending hod dept75', `
    select sl.* from student_leaves sl
    join students s on s.id = sl.student_id
    join classes c on c.id = s.class_id
    where c.department_id = 75 and sl.status='faculty_approved' and sl.approved_by_hod_user_id is null
  `);
  await q('student_leaves sample any dept (for enum ref)', `select * from student_leaves order by id desc limit 3`);
  await q('student_leaves count total', `select status, count(*) from student_leaves group by status`);

  // od_requests pending hod for dept 75 students
  await q('od_request_hod_approvals pending for hod_user 38512 or dept75', `
    select oha.* from od_request_hod_approvals oha
    where oha.department_id = 75 and oha.status='pending'
  `);
  await q('od_request_hod_approvals sample', `select * from od_request_hod_approvals order by id desc limit 3`);
  await q('od_requests sample', `select * from od_requests order by id desc limit 3`);
  await q('od_teams sample', `select * from od_teams order by id desc limit 3`);
  await q('od_team_members sample', `select * from od_team_members order by id desc limit 3`);

  // 2. faculty_leaves pending hod approval, dept 75 faculty
  await q('faculty_leaves pending hod dept75', `
    select fl.* from faculty_leaves fl
    join faculty f on f.id = fl.faculty_id
    where f.department_id = 75 and fl.hod_approval_status='pending'
  `);
  await q('faculty_leaves sample any', `select * from faculty_leaves order by id desc limit 3`);
  await q('leave_types sample', `select * from leave_types limit 10`);

  // 3. HoD's own faculty_leaves
  await q('faculty_leaves for faculty 3503', `select * from faculty_leaves where faculty_id=3503`);

  // 4. payslip_requests / salary_payments for faculty 3503
  await q('payslip_requests faculty 3503', `select * from payslip_requests where faculty_id=3503`);
  await q('payslip_requests sample any', `select * from payslip_requests order by id desc limit 3`);
  await q('salary_payments faculty 3503', `select * from salary_payments where faculty_id=3503`);
  await q('salary_payments sample any', `select * from salary_payments order by id desc limit 3`);
  await q('salary_divisions faculty 3503', `select * from salary_divisions where faculty_id=3503`);
  await q('salary_divisions sample any', `select * from salary_divisions order by id desc limit 5`);

  // 5. appraisal_requests for faculty 3503
  await q('appraisal_requests faculty 3503', `select * from appraisal_requests where faculty_id=3503`);
  await q('appraisal_requests sample any', `select * from appraisal_requests order by id desc limit 3`);
  await q('appraisal_divisions all', `select * from appraisal_divisions`);
  await q('appraisal_criteria sample', `select * from appraisal_criteria order by id desc limit 10`);
  await q('appraisal_entries sample', `select * from appraisal_entries order by id desc limit 5`);

  // 6. faculty_daily_attendance for faculty 3503
  await q('faculty_daily_attendance faculty 3503', `select * from faculty_daily_attendance where faculty_id=3503 order by attendance_date desc limit 10`);
  await q('faculty_daily_attendance sample any', `select * from faculty_daily_attendance order by id desc limit 3`);
  await q('faculty_daily_attendance count faculty 3503', `select count(*) from faculty_daily_attendance where faculty_id=3503`);

  // 7. dept 75 students count via classes
  await q('classes in dept 75', `select id, section, department_id, current_semester from classes where department_id=75`);
  await q('students count dept75', `
    select count(*) from students s join classes c on c.id=s.class_id where c.department_id=75
  `);
  await q('exam_marks count for dept75 students', `
    select count(*) from exam_marks em join students s on s.id=em.student_id join classes c on c.id=s.class_id where c.department_id=75
  `);
  await q('attendance_records count dept75', `
    select count(*) from attendance_records ar join students s on s.id=ar.student_id join classes c on c.id=s.class_id where c.department_id=75
  `);

  // 8. wallet for user 38512
  await q('wallets user 38512', `select * from wallets where user_id=38512`);
  await q('wallet_transactions for hod wallet', `
    select wt.* from wallet_transactions wt join wallets w on w.id=wt.wallet_id where w.user_id=38512
  `);
  await q('wallets sample any', `select * from wallets order by id desc limit 3`);
  await q('wallet_transactions sample any', `select * from wallet_transactions order by id desc limit 3`);
  await q('wallet_outlets sample', `select * from wallet_outlets limit 5`);

  // 9. messaging for user 38512
  await q('message_participants for user 38512', `select * from message_participants where user_id=38512`);
  await q('message_conversations sample', `select * from message_conversations order by id desc limit 3`);
  await q('messages sample', `select * from messages order by id desc limit 3`);

  // supporting: class_mentors for dept 75, faculty in dept 75 (for faculty_guide_id / mentor references)
  await q('faculty in dept 75', `select id, name, user_id, department_id from faculty where department_id=75 order by id`);
  await q('class_mentors dept75', `select cm.* from class_mentors cm join classes c on c.id=cm.class_id where c.department_id=75`);
  await q('departments 75', `select * from departments where id=75`);

  // users table columns relevant
  await q('users sample structure for hod', `select * from users where id=38512`);

  await client.end();
}

main().catch(e => { console.error(e); process.exit(1); });
