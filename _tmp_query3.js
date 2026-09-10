require('dotenv').config({ path: '.env' });
const { PrismaClient } = require('./generated/prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');

(async () => {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter });
  const q = async (sql) => {
    for (let i = 0; i < 3; i++) {
      try { return await prisma.$queryRawUnsafe(sql); }
      catch (e) { if (i === 2 || !String(e.message).includes('ETIMEDOUT')) throw e; }
    }
  };

  // dept label -> class ids (only populated classes, matching known anchors)
  const deptClasses = { 1: [1,2,3,8,9], 2: [4,5,10,11], 3: [6,7,12,13] };

  const sql0 = `
    SELECT class_id, count(*) FROM students
    WHERE class_id IN (1,2,3,8,9,4,5,10,11,6,7,12,13)
    GROUP BY class_id ORDER BY class_id;
  `;
  console.log('=== students per class ===');
  console.log(JSON.stringify(await q(sql0), (k,v)=>typeof v==='bigint'?Number(v):v));

  const tables = [
    'parent_student_mapping','book_borrow_records','student_hostel_mapping',
    'attendance_records','exam_marks','hall_tickets','marksheets',
    'student_drive_applications','student_no_due_status','student_scholarship_awards',
    'student_test_scores','student_projects','student_profiles','student_certificates',
    'student_addresses','student_family_details','student_contacts','student_sensitive_info',
    'student_identity_marks','student_transport_mapping','student_leaves','student_meeting_notes',
    'student_health_records','student_outpasses','student_escalations','student_sports_team_mapping',
    'sports_equipment_issues','hostel_complaints','hostel_mess_feedback','hostel_outings',
    'hostel_in_out_ledger','hall_ticket_clearance_exceptions','revaluation_requests',
    'feedback_responses','student_assignment_status','bonafide_requests',
    'student_entrepreneurship','student_higher_education',
  ];

  for (const t of tables) {
    const sql2 = `
      SELECT s.class_id,
             COUNT(*) AS n_rows,
             COUNT(DISTINCT tt.student_id) AS n_distinct_students
      FROM students s
      JOIN ${t} tt ON tt.student_id = s.id
      WHERE s.class_id IN (1,2,3,8,9,4,5,10,11,6,7,12,13)
      GROUP BY s.class_id
      ORDER BY s.class_id;
    `;
    try {
      const res = await q(sql2);
      console.log(`=== ${t} ===`);
      console.log(JSON.stringify(res, (k,v)=>typeof v==='bigint'?Number(v):v));
    } catch (e) {
      console.log(`=== ${t} ERROR: ${e.message.split('\n')[0]} ===`);
    }
  }

  // lms tables and other class_id-scoped tables
  const classTables = ['lms_notes', 'lms_folder_classes'];
  for (const t of classTables) {
    const sql3 = `
      SELECT class_id, COUNT(*) FROM ${t}
      WHERE class_id IN (1,2,3,8,9,4,5,10,11,6,7,12,13)
      GROUP BY class_id ORDER BY class_id;
    `;
    try {
      const res = await q(sql3);
      console.log(`=== ${t} (by class_id) ===`);
      console.log(JSON.stringify(res, (k,v)=>typeof v==='bigint'?Number(v):v));
    } catch (e) {
      console.log(`=== ${t} ERROR: ${e.message.split('\n')[0]} ===`);
    }
  }

  await prisma.$disconnect();
})();
