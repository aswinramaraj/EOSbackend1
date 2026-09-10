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
  const p = async (sql) => JSON.stringify(await q(sql), (k,v)=>typeof v==='bigint'?Number(v):v, 2);

  console.log('=== AIDS students (class 4,5,10,11) sample ===');
  console.log(await p(`SELECT id, user_id, student_id_no, class_id, batch_id FROM students WHERE class_id IN (4,5,10,11) ORDER BY class_id, id LIMIT 12`));

  console.log('=== which AIDS students already have: profile/address/family/sensitive/transport/health ===');
  console.log(await p(`
    SELECT s.id, s.class_id,
      (sp.id IS NOT NULL) AS has_profile,
      (sa.id IS NOT NULL) AS has_address,
      (fd.id IS NOT NULL) AS has_family,
      (si.id IS NOT NULL) AS has_sensitive,
      (tm.id IS NOT NULL) AS has_transport,
      (hr.id IS NOT NULL) AS has_health
    FROM students s
    LEFT JOIN student_profiles sp ON sp.student_id = s.id
    LEFT JOIN student_addresses sa ON sa.student_id = s.id
    LEFT JOIN student_family_details fd ON fd.student_id = s.id
    LEFT JOIN student_sensitive_info si ON si.student_id = s.id
    LEFT JOIN student_transport_mapping tm ON tm.student_id = s.id
    LEFT JOIN student_health_records hr ON hr.student_id = s.id
    WHERE s.class_id IN (4,5,10,11)
    ORDER BY s.class_id, s.id
  `));

  console.log('=== CS example: student_profiles ===');
  console.log(await p(`SELECT * FROM student_profiles WHERE student_id IN (SELECT id FROM students WHERE class_id=1) LIMIT 2`));

  console.log('=== CS example: student_addresses ===');
  console.log(await p(`SELECT * FROM student_addresses WHERE student_id IN (SELECT id FROM students WHERE class_id=1) LIMIT 3`));

  console.log('=== CS example: student_family_details ===');
  console.log(await p(`SELECT * FROM student_family_details WHERE student_id IN (SELECT id FROM students WHERE class_id=1) LIMIT 2`));

  console.log('=== CS example: student_sensitive_info ===');
  console.log(await p(`SELECT * FROM student_sensitive_info WHERE student_id IN (SELECT id FROM students WHERE class_id=1) LIMIT 2`));

  console.log('=== CS example: student_transport_mapping ===');
  console.log(await p(`SELECT * FROM student_transport_mapping WHERE student_id IN (SELECT id FROM students WHERE class_id IN (1,2,3)) LIMIT 3`));

  console.log('=== CS example: student_health_records ===');
  console.log(await p(`SELECT * FROM student_health_records WHERE student_id IN (SELECT id FROM students WHERE class_id IN (1,2)) LIMIT 2`));

  console.log('=== CS example: bonafide_requests + bonafide_reasons ===');
  console.log(await p(`SELECT * FROM bonafide_requests WHERE student_id IN (SELECT id FROM students WHERE class_id IN (1,2,3)) LIMIT 3`));
  console.log(await p(`SELECT * FROM bonafide_reasons LIMIT 5`));

  console.log('=== CS example: hostel_complaints, hostel_mess_feedback, hostel_outings ===');
  console.log(await p(`SELECT * FROM hostel_complaints LIMIT 2`));
  console.log(await p(`SELECT * FROM hostel_mess_feedback LIMIT 2`));
  console.log(await p(`SELECT * FROM hostel_outings LIMIT 2`));

  console.log('=== which AIDS students are in student_hostel_mapping (for hostel feature seeds) ===');
  console.log(await p(`SELECT shm.student_id, shm.room_id, s.class_id FROM student_hostel_mapping shm JOIN students s ON s.id=shm.student_id WHERE s.class_id IN (4,5,10,11)`));

  console.log('=== CS example: lms_folder_classes + lms_folders ===');
  console.log(await p(`SELECT * FROM lms_folder_classes LIMIT 5`));
  console.log(await p(`SELECT * FROM lms_folders WHERE id IN (SELECT folder_id FROM lms_folder_classes) LIMIT 5`));
  console.log('=== AIDS subjects/faculty for lms_folders (need subject_id + faculty_id valid for AIDS) ===');
  console.log(await p(`SELECT id, subject_id, class_id, faculty_id, title FROM lms_notes WHERE class_id IN (4,5,10,11) LIMIT 5`));

  console.log('=== student_identity_marks CS example ===');
  console.log(await p(`SELECT * FROM student_identity_marks WHERE student_id IN (SELECT id FROM students WHERE class_id=1) LIMIT 3`));

  await prisma.$disconnect();
})();
