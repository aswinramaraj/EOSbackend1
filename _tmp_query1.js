require('dotenv').config({ path: '.env' });
const { PrismaClient } = require('./generated/prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');

(async () => {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter });
  const q = async (sql) => {
    for (let i = 0; i < 3; i++) {
      try {
        return await prisma.$queryRawUnsafe(sql);
      } catch (e) {
        if (i === 2 || !String(e.message).includes('ETIMEDOUT')) throw e;
      }
    }
  };

  const sql = `
    WITH dept_students AS (
      SELECT s.id AS student_id, s.user_id, c.department_id
      FROM students s
      JOIN courses c ON c.id = s.course_id
      WHERE c.department_id IN (1,2,3)
    )
    SELECT department_id, COUNT(*) AS n_students FROM dept_students GROUP BY department_id ORDER BY department_id;
  `;
  console.log('=== student counts by dept (via course_id) ===');
  console.log(JSON.stringify(await q(sql), (k,v)=>typeof v==='bigint'?Number(v):v, 2));

  const tables = [
    { name: 'parent_student_mapping', col: 'student_id' },
    { name: 'book_borrow_records', col: 'student_id' },
    { name: 'student_hostel_mapping', col: 'student_id' },
    { name: 'attendance_records', col: 'student_id' },
    { name: 'exam_marks', col: 'student_id' },
    { name: 'hall_tickets', col: 'student_id' },
    { name: 'marksheets', col: 'student_id' },
    { name: 'student_drive_applications', col: 'student_id' },
    { name: 'student_no_due_status', col: 'student_id' },
    { name: 'student_scholarship_awards', col: 'student_id' },
    { name: 'student_test_scores', col: 'student_id' },
    { name: 'student_projects', col: 'student_id' },
    { name: 'student_profiles', col: 'student_id' },
    { name: 'student_certificates', col: 'student_id' },
    { name: 'student_addresses', col: 'student_id' },
    { name: 'student_family_details', col: 'student_id' },
    { name: 'student_contacts', col: 'student_id' },
    { name: 'student_sensitive_info', col: 'student_id' },
    { name: 'student_identity_marks', col: 'student_id' },
    { name: 'student_transport_mapping', col: 'student_id' },
    { name: 'student_leaves', col: 'student_id' },
    { name: 'student_meeting_notes', col: 'student_id' },
    { name: 'student_health_records', col: 'student_id' },
    { name: 'student_outpasses', col: 'student_id' },
    { name: 'student_escalations', col: 'student_id' },
    { name: 'student_sports_team_mapping', col: 'student_id' },
    { name: 'sports_equipment_issues', col: 'student_id' },
    { name: 'hostel_complaints', col: 'student_id' },
    { name: 'hostel_mess_feedback', col: 'student_id' },
    { name: 'hostel_outings', col: 'student_id' },
    { name: 'hostel_in_out_ledger', col: 'student_id' },
    { name: 'hall_ticket_clearance_exceptions', col: 'student_id' },
    { name: 'revaluation_requests', col: 'student_id' },
    { name: 'feedback_responses', col: 'student_id' },
    { name: 'student_assignment_status', col: 'student_id' },
    { name: 'bonafide_requests', col: 'student_id' },
    { name: 'student_entrepreneurship', col: 'student_id' },
    { name: 'student_higher_education', col: 'student_id' },
  ];

  for (const t of tables) {
    const sql2 = `
      WITH dept_students AS (
        SELECT s.id AS student_id, c.department_id
        FROM students s
        JOIN courses c ON c.id = s.course_id
        WHERE c.department_id IN (1,2,3)
      )
      SELECT ds.department_id,
             COUNT(*) AS n_rows,
             COUNT(DISTINCT tt.${t.col}) AS n_distinct_students
      FROM dept_students ds
      JOIN ${t.name} tt ON tt.${t.col} = ds.student_id
      GROUP BY ds.department_id
      ORDER BY ds.department_id;
    `;
    try {
      const res = await q(sql2);
      console.log(`=== ${t.name} ===`);
      console.log(JSON.stringify(res, (k,v)=>typeof v==='bigint'?Number(v):v));
    } catch (e) {
      console.log(`=== ${t.name} ERROR: ${e.message.split('\n')[0]} ===`);
    }
  }

  await prisma.$disconnect();
})();
