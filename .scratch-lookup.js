require('dotenv').config();
const { Client } = require('pg');
(async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const user = await client.query(`SELECT id, email, role FROM users WHERE email = $1`, ['dinesh.j2023aids@sece.ac.in']);
  console.log('USER:', JSON.stringify(user.rows));
  if (user.rows.length === 0) { await client.end(); return; }
  const userId = user.rows[0].id;
  const student = await client.query(`
    SELECT s.id, s.student_id_no, s.roll_no, s.class_id, s.batch_id, s.course_id, s.quota_id, s.gender, s.date_of_birth,
           c.section, c.department_id, b.name as batch_name, co.name as course_name
    FROM students s
    LEFT JOIN classes c ON c.id = s.class_id
    LEFT JOIN batches b ON b.id = s.batch_id
    LEFT JOIN courses co ON co.id = s.course_id
    WHERE s.user_id = $1`, [userId]);
  console.log('STUDENT:', JSON.stringify(student.rows, null, 2));
  await client.end();
})().catch(e => { console.error(e); process.exit(1); });
