const { Client } = require('pg');
const envtxt = require('fs').readFileSync('.env', 'utf8');
envtxt.split(/\r?\n/).forEach(l => {
  const m = l.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, '');
});

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const q = async (label, sql) => {
    try {
      const res = await client.query(sql);
      console.log(`\n=== ${label} (${res.rowCount} rows) ===`);
      console.log(JSON.stringify(res.rows, null, 2));
    } catch (e) {
      console.log(`\n=== ${label} ERROR ===`);
      console.log(e.message);
    }
  };

  // 1. Library
  await q('book_borrow_records staff_user_id=38497', `select * from book_borrow_records where staff_user_id = 38497`);
  await q('sample staff borrow records (any staff)', `select * from book_borrow_records where borrower_type='staff' limit 3`);
  await q('sample book_borrow_records any', `select * from book_borrow_records order by id desc limit 3`);
  await q('books sample', `select id, title, available_copies, total_copies from books limit 3`);

  // 2. Payslip
  await q('payslip_requests count total', `select count(*) from payslip_requests`);
  await q('payslip_requests for staff_user_id=38497', `select * from payslip_requests where staff_user_id=38497`);
  await q('payslip_requests latest month/year distribution', `select year, month, status, count(*) from payslip_requests group by year, month, status order by year desc, month desc limit 20`);
  await q('payslip_requests sample', `select * from payslip_requests order by id desc limit 5`);
  await q('faculty count', `select count(*) from faculty`);
  await q('non_teaching_staff count', `select count(*) from non_teaching_staff`);

  // hr_payroll_requests
  await q('hr_payroll_requests count', `select count(*) from hr_payroll_requests`);
  await q('hr_payroll_requests sample', `select * from hr_payroll_requests order by id desc limit 5`);
  await q('hr_payroll_requests requested_by=38497', `select * from hr_payroll_requests where requested_by_user_id=38497 or assigned_hr_user_id=38497`);

  // 3. attendance
  await q('faculty_daily_attendance count', `select count(*) from faculty_daily_attendance`);
  await q('faculty_daily_attendance sample', `select * from faculty_daily_attendance order by id desc limit 3`);
  await q('faculty_daily_attendance recent months', `select date_trunc('month', attendance_date) as month, count(*) from faculty_daily_attendance group by 1 order by 1 desc limit 6`);

  // 4. appraisal
  await q('appraisal_requests count', `select count(*) from appraisal_requests`);
  await q('appraisal_requests by status', `select status, count(*) from appraisal_requests group by status`);
  await q('appraisal_requests sample', `select * from appraisal_requests order by id desc limit 5`);
  await q('appraisal_requests staff_user_id=38497', `select * from appraisal_requests where staff_user_id=38497`);

  // 5. profile
  await q('users 38497', `select id, email, phone, role_id, status from users where id=38497`);
  await q('roles 25', `select * from roles where id=25`);
  await q('non_teaching_staff for user 38497', `select * from non_teaching_staff where user_id=38497`);
  await q('non_teaching_staff sample', `select * from non_teaching_staff limit 3`);
  await q('user_social_links 38497', `select * from user_social_links where user_id=38497`);

  // 6. wallet
  await q('wallets for 38497', `select * from wallets where user_id=38497`);
  await q('wallets sample any staff role', `select w.* from wallets w join users u on u.id=w.user_id where u.role_id=25 limit 3`);
  await q('wallet_transactions sample', `select * from wallet_transactions order by id desc limit 3`);

  // 7. messaging
  await q('message_participants for 38497', `select * from message_participants where user_id=38497`);
  await q('message_participants sample', `select * from message_participants limit 3`);

  // 8. announcements/notifications
  await q('announcement_role_mapping role_id=25', `select * from announcement_role_mapping where role_id=25`);
  await q('announcement_role_mapping sample', `select * from announcement_role_mapping limit 5`);
  await q('notifications for 38497 count', `select count(*) from notifications where user_id=38497`);
  await q('notifications sample', `select * from notifications order by id desc limit 3`);

  await client.end();
}

main().catch(e => { console.error(e); process.exit(1); });
