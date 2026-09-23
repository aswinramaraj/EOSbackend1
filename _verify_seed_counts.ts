import 'dotenv/config';
import { Pool } from 'pg';

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL!, connectionTimeoutMillis: 15000 });
  const q = (sql: string) => pool.query(sql).then((r) => r.rows);

  console.log('=== Students per test batch ===');
  console.log(await q(`
    SELECT b.name AS batch, count(*) AS student_count
    FROM students s JOIN classes c ON s.class_id = c.id JOIN batches b ON s.batch_id = b.id
    WHERE c.section = 'Z' AND c.department_id = 75
    GROUP BY b.name ORDER BY b.name
  `));

  console.log('=== Total test students ===');
  console.log(await q(`SELECT count(*) FROM students s JOIN classes c ON s.class_id = c.id WHERE c.section='Z' AND c.department_id=75`));

  console.log('=== Orphan check: students with null class_id among test set (should be 0) ===');
  console.log(await q(`SELECT count(*) FROM students WHERE student_id_no LIKE 'TCSE%' AND class_id IS NULL`));

  console.log('=== Orphan check: parent_student_mapping pointing to non-existent students (should be 0) ===');
  console.log(await q(`SELECT count(*) FROM parent_student_mapping psm LEFT JOIN students s ON psm.student_id = s.id WHERE s.id IS NULL`));

  console.log('=== class_mentors for advisor class ===');
  console.log(await q(`SELECT * FROM class_mentors WHERE class_id = 1285`));

  console.log('=== faculty_subject_class_mapping for subject faculty (4004) ===');
  console.log(await q(`SELECT * FROM faculty_subject_class_mapping WHERE faculty_id = 4004`));

  console.log('=== faculty_subject_class_mapping for hod+faculty (4006) ===');
  console.log(await q(`SELECT * FROM faculty_subject_class_mapping WHERE faculty_id = 4006`));

  console.log('=== attendance_records count for advisor class ===');
  console.log(await q(`SELECT status, count(*) FROM attendance_records WHERE class_id=1285 GROUP BY status`));

  console.log('=== attendance orphan check (student not in students table) ===');
  console.log(await q(`SELECT count(*) FROM attendance_records ar LEFT JOIN students s ON ar.student_id=s.id WHERE s.id IS NULL`));

  console.log('=== exam_marks orphan check ===');
  console.log(await q(`SELECT count(*) FROM exam_marks em LEFT JOIN students s ON em.student_id=s.id WHERE s.id IS NULL`));

  console.log('=== student_leaves for advisor class students ===');
  console.log(await q(`SELECT id, student_id, status, reason FROM student_leaves WHERE reason = 'Seeded test leave request'`));

  console.log('=== od_requests + team ===');
  console.log(await q(`SELECT o.id, o.reason, o.mentor_approval_status, t.unique_code FROM od_requests o JOIN od_teams t ON o.team_id=t.id WHERE t.unique_code='TESTOD01'`));

  console.log('=== assignments + submission stats for advisor class ===');
  console.log(await q(`
    SELECT a.id, a.title, count(sas.*) FILTER (WHERE sas.is_submitted) AS submitted, count(sas.*) FILTER (WHERE NOT sas.is_submitted) AS pending
    FROM assignments a LEFT JOIN student_assignment_status sas ON sas.assignment_id = a.id
    WHERE a.class_id = 1285 GROUP BY a.id, a.title
  `));

  console.log('=== timetable_slots for advisor class ===');
  console.log(await q(`SELECT * FROM timetable_slots WHERE class_id = 1285`));

  console.log('=== announcements (seeded) ===');
  console.log(await q(`SELECT id, title, target_audience, department_id FROM announcements WHERE title LIKE 'Seeded Test%'`));

  console.log('=== placement drive applications ===');
  console.log(await q(`SELECT count(*) FROM student_drive_applications sda JOIN placement_drives pd ON sda.drive_id=pd.id JOIN companies c ON pd.company_id=c.id WHERE c.name='Seeded Test Technologies'`));

  console.log('=== 4 faculty test accounts - full detail ===');
  console.log(await q(`
    SELECT u.email, r.name AS role, f.id AS faculty_id, f.department_id, f.designation
    FROM users u JOIN roles r ON u.role_id = r.id LEFT JOIN faculty f ON f.user_id = u.id
    WHERE u.email IN ('cse.advisor.test@erp.test','cse.subjectfaculty.test@erp.test','cse.hod.test@erp.test','cse.hodfaculty.test@erp.test')
  `));

  console.log('=== responsibilities check: does advisor faculty have a class_mentors row? ===');
  console.log(await q(`SELECT count(*) FROM class_mentors WHERE faculty_id = 4003`));
  console.log('=== responsibilities check: does hodfaculty (4006) have BOTH hod role and mapping row? ===');
  console.log(await q(`SELECT count(*) FROM faculty_subject_class_mapping WHERE faculty_id = 4006`));

  await pool.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
