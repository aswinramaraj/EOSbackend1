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

  await q('notifications actual rows for 38497', `select * from notifications where user_id=38497 order by id desc`);
  await q('wallets by role distribution', `select u.role_id, r.name, count(*) from wallets w join users u on u.id=w.user_id join roles r on r.id=u.role_id group by 1,2 order by 3 desc`);
  await q('max id book_borrow_records', `select max(id) from book_borrow_records`);
  await q('books with available copies', `select id, title, available_copies from books where available_copies > 0 order by id limit 5`);
  await q('appraisal current academic year distinct', `select distinct academic_year from appraisal_requests`);
  await q('faculty without appraisal_requests 2026-2027', `
    select f.id, f.first_name, f.last_name, f.department_id, d.code, f.user_id
    from faculty f
    join departments d on d.id = f.department_id
    where f.status='active' and not exists (
      select 1 from appraisal_requests ar where ar.faculty_id = f.id and ar.academic_year='2026-2027'
    ) order by f.id limit 10`);
  await q('faculty columns sample', `select * from faculty where id=3503`);
  await q('max id appraisal_requests', `select max(id) from appraisal_requests`);
  await q('max id hr_payroll_requests', `select max(id) from hr_payroll_requests`);
  await q('max id payslip_requests', `select max(id) from payslip_requests`);
  await q('max id wallets', `select max(id) from wallets`);
  await q('max id wallet_transactions', `select max(id) from wallet_transactions`);
  await q('max id notifications', `select max(id) from notifications`);
  await q('max id message_participants', `select max(id) from message_participants`);
  await q('max id user_social_links', `select max(id) from user_social_links`);
  await q('non_teaching_staff status enum sample distinct', `select distinct status from non_teaching_staff`);
  await q('non_teaching_staff category distinct', `select distinct category from non_teaching_staff`);
  await q('departments sample', `select id, name, code from departments limit 5`);
  await client.end();
}
main().catch(e => { console.error(e); process.exit(1); });
