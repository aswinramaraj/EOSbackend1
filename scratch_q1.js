require('dotenv').config();
const {Client} = require('pg');
(async () => {
  const client = new Client({connectionString: process.env.DATABASE_URL});
  await client.connect();

  const q = async (label, sql) => {
    console.log('\n=== ' + label + ' ===');
    const r = await client.query(sql);
    console.log(JSON.stringify(r.rows, null, 2));
  };

  await q('student 20884 basic', `select id, student_id_no, roll_no, class_id, gender from students where id=20884`);
  await q('class 1233', `select * from classes where id=1233`);
  await q('class_mentors for class 1233', `select * from class_mentors where class_id=1233`);
  await q('books sample (dept 82 or any)', `select id, title, author, category_id, total_copies, available_copies, department_id from books where available_copies > 0 order by id limit 8`);
  await q('book_borrow_records sample', `select * from book_borrow_records order by id desc limit 5`);
  await q('od_teams sample', `select * from od_teams order by id desc limit 5`);
  await q('od_requests sample', `select * from od_requests order by id desc limit 5`);
  await q('od_team_members sample', `select * from od_team_members order by id desc limit 5`);
  await q('student_leaves sample', `select * from student_leaves order by id desc limit 5`);
  await q('bonafide_reasons all', `select * from bonafide_reasons`);
  await q('bonafide_requests sample', `select * from bonafide_requests order by id desc limit 5`);
  await q('student_no_due_status sample', `select * from student_no_due_status order by id desc limit 5`);
  await q('student_hostel_mapping sample', `select * from student_hostel_mapping order by id desc limit 5`);
  await q('student_hostel_mapping for this student', `select * from student_hostel_mapping where student_id=20884`);
  await q('hostels all', `select * from hostels limit 10`);
  await q('hostel_rooms sample', `select * from hostel_rooms order by id limit 10`);

  await client.end();
})().catch(e=>{console.error(e); process.exit(1)});
