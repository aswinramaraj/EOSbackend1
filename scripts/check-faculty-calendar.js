require('dotenv/config');
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
(async () => {
  const cal = await pool.query(`SELECT count(*) FROM academic_calendars`);
  console.log('academic_calendars rows total:', cal.rows[0].count);

  const ev = await pool.query(`SELECT count(*) FROM calendar_events`);
  console.log('calendar_events rows total:', ev.rows[0].count);

  const fac = await pool.query(`
    SELECT f.id as faculty_id, u.email, fscm.academic_year, c.batch_id, c.current_semester
    FROM faculty f
    JOIN users u ON u.id = f.user_id
    JOIN faculty_subject_class_mapping fscm ON fscm.faculty_id = f.id
    JOIN classes c ON c.id = fscm.class_id
    WHERE u.email = 'uday.u.cs4@sece.ac.in'
    ORDER BY fscm.academic_year DESC
    LIMIT 10
  `);
  console.log('uday faculty_subject_class_mapping rows:', fac.rows);

  if (fac.rows.length > 0) {
    const { batch_id, current_semester } = fac.rows[0];
    const acRow = await pool.query(
      `SELECT * FROM academic_calendars WHERE batch_id = $1 AND semester = $2`,
      [batch_id, current_semester],
    );
    console.log(`academic_calendars for batch_id=${batch_id} semester=${current_semester}:`, acRow.rows);
  }

  await pool.end();
})();
