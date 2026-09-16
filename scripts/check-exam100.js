require('dotenv/config');
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
(async () => {
  const r = await pool.query(`SELECT id, title, status, semester, batch_id, exam_type_id, academic_year FROM exams WHERE id = 100`);
  console.log(r.rows);
  const t = await pool.query(`SELECT id, name FROM exam_types WHERE id = (SELECT exam_type_id FROM exams WHERE id=100)`);
  console.log(t.rows);
  await pool.end();
})();
