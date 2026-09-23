/**
 * Comprehensive CSE test-data seed - Phase 1.
 *
 * Additive, idempotent, safely rerunnable. Reuses real existing
 * infrastructure (CSE department id=75/code='CS', course id=73, 4 of the 5
 * requested batches, existing CSE subjects CS1xx-CS7xx, existing exam_types
 * CIA1/CIA2/CIA3, existing leave_types, existing grade_bands) rather than
 * inventing new ones. Creates exactly ONE new batch (2022-2026, the only
 * one of the 5 requested that didn't already exist) and 5 dedicated
 * section='Z' test classes (one per batch) so the 500 synthetic test
 * students never mix into the real A/B/C/D sections' rosters.
 *
 * Password hashing matches this repo's real auth.service.ts exactly:
 * sha256 hex digest (NOT bcrypt - bcrypt is an unused dependency here).
 * Every login uses the same test password: EOS@test123
 *
 * Run: npx ts-node prisma/seed-cse-comprehensive.ts
 */
import 'dotenv/config';
import * as crypto from 'crypto';
import { PrismaClient } from '../generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter } as any) as any;

const TEST_PASSWORD = 'EOS@test123';
const PASSWORD_HASH = crypto.createHash('sha256').update(TEST_PASSWORD).digest('hex');

const CSE_DEPT_ID = 75;
const CSE_COURSE_ID = 73;
const QUOTA_ID = 33; // Management
const AY = '2026-2027';
const CIA1_EXAM_TYPE_ID = 25;
const UNIV_END_EXAM_TYPE_ID = 28;
const CASUAL_LEAVE_TYPE_ID = 19;
const DESIGNATION_ASST_PROF = 59;
const DESIGNATION_ASSOC_PROF_HOD = 63;

const FIRST_NAMES = [
  'Arjun', 'Priya', 'Karthik', 'Divya', 'Vishal', 'Anitha', 'Rahul', 'Sneha',
  'Suresh', 'Meena', 'Ganesh', 'Lakshmi', 'Vignesh', 'Pooja', 'Arun', 'Kavya',
  'Naveen', 'Deepika', 'Praveen', 'Swathi',
];
const LAST_NAMES = ['Kumar', 'Raj', 'Prasad', 'Reddy', 'Sharma', 'Nair', 'Iyer', 'Pillai', 'Rao', 'Gupta'];

function nameFor(i: number): string {
  return `${FIRST_NAMES[i % FIRST_NAMES.length]} ${LAST_NAMES[i % LAST_NAMES.length]}`;
}

// Batch -> {semester, subject_ids} - reuses real existing CSE subjects for
// every semester that already has curriculum seeded (1/3/5/7). Semester 8
// has none seeded anywhere in this department yet (confirmed via direct
// query), so 4 new CS8xx subjects are created for it below - genuinely new
// curriculum, not a duplicate of anything existing.
const SEM1_SUBJECTS = [1681, 1682, 1683, 1684, 1685, 1686]; // CS101-106
const SEM3_SUBJECTS = [1687, 1688, 1689, 1690, 1691, 1692]; // CS301-306
const SEM5_SUBJECTS = [1693, 1694, 1695, 1696, 1697, 1698]; // CS501-506
const SEM7_SUBJECTS = [1699, 1700, 1701, 1702, 1703, 1704]; // CS701-706

type BatchPlan = { batchName: string; startYear: number; endYear: number; semester: number; subjectIds: number[] };

const BATCH_PLANS: BatchPlan[] = [
  { batchName: '2026-2030', startYear: 2026, endYear: 2030, semester: 1, subjectIds: SEM1_SUBJECTS },
  { batchName: '2025-2029', startYear: 2025, endYear: 2029, semester: 3, subjectIds: SEM3_SUBJECTS },
  { batchName: '2024-2028', startYear: 2024, endYear: 2028, semester: 5, subjectIds: SEM5_SUBJECTS },
  { batchName: '2023-2027', startYear: 2023, endYear: 2027, semester: 7, subjectIds: SEM7_SUBJECTS },
  { batchName: '2022-2026', startYear: 2022, endYear: 2026, semester: 8, subjectIds: [] }, // filled in after sem-8 subjects are created
];

async function ensureRole(name: string): Promise<number> {
  const role = await prisma.roles.findUnique({ where: { name } });
  if (!role) throw new Error(`Role "${name}" does not exist in the roles table - refusing to invent a new role.`);
  return role.id;
}

async function upsertUser(email: string, roleId: number): Promise<number> {
  const user = await prisma.users.upsert({
    where: { email },
    update: {},
    create: { email, password_hash: PASSWORD_HASH, role_id: roleId, status: 'active' },
  });
  return user.id;
}

async function upsertFaculty(userId: number, firstName: string, lastName: string, departmentId: number, designationId: number, staffCode: string) {
  const existing = await prisma.faculty.findUnique({ where: { user_id: userId } });
  if (existing) return existing;
  return prisma.faculty.create({
    data: {
      user_id: userId,
      first_name: firstName,
      last_name: lastName,
      designation: designationId === DESIGNATION_ASSOC_PROF_HOD ? 'Associate Professor & HOD' : 'Assistant Professor',
      department_id: departmentId,
      designation_id: designationId,
      staff_code: staffCode,
      status: 'active',
      is_mentor: true,
    },
  });
}

async function main() {
  console.log('=== Phase 1: CSE comprehensive test-data seed ===\n');

  const studentRoleId = await ensureRole('student');
  const parentRoleId = await ensureRole('parent');
  const facultyRoleId = await ensureRole('faculty');
  const hodRoleId = await ensureRole('hod');

  // ---- 1. Ensure the one missing batch exists ----
  console.log('1. Batches...');
  const batchRows: Record<string, number> = {};
  for (const plan of BATCH_PLANS) {
    const batch = await prisma.batches.upsert({
      where: { name: plan.batchName },
      update: {},
      create: { name: plan.batchName, start_year: plan.startYear, end_year: plan.endYear },
    });
    batchRows[plan.batchName] = batch.id;
  }
  console.log('   batches ready:', batchRows);

  // ---- 2. Semester-8 subjects (only gap in existing curriculum) ----
  console.log('2. Semester 8 subjects (new - none existed for this department)...');
  const sem8Defs = [
    { code: 'CS801', name: 'Project Work', credits: 6 },
    { code: 'CS802', name: 'Professional Elective III', credits: 3 },
    { code: 'CS803', name: 'Open Elective II', credits: 3 },
    { code: 'CS804', name: 'Industrial Internship', credits: 2 },
  ];
  const sem8SubjectIds: number[] = [];
  for (const s of sem8Defs) {
    const subj = await prisma.subjects.upsert({
      where: { subject_code: s.code },
      update: {},
      create: { subject_code: s.code, name: s.name, department_id: CSE_DEPT_ID, semester: 8, credits: s.credits },
    });
    sem8SubjectIds.push(subj.id);
  }
  BATCH_PLANS.find((p) => p.batchName === '2022-2026')!.subjectIds = sem8SubjectIds;
  console.log('   sem-8 subject ids:', sem8SubjectIds);

  // ---- 3. One dedicated test class per batch (section 'Z') ----
  console.log("3. Test classes (section 'Z', one per batch)...");
  const classByBatch: Record<string, { id: number; semester: number; subjectIds: number[] }> = {};
  for (const plan of BATCH_PLANS) {
    const batchId = batchRows[plan.batchName];
    const cls = await prisma.classes.upsert({
      where: { batch_id_course_id_section: { batch_id: batchId, course_id: CSE_COURSE_ID, section: 'Z' } },
      update: { current_semester: plan.semester },
      create: {
        batch_id: batchId,
        department_id: CSE_DEPT_ID,
        course_id: CSE_COURSE_ID,
        section: 'Z',
        current_semester: plan.semester,
        classroom: 'Test Block - Room Z1',
      },
    });
    classByBatch[plan.batchName] = { id: cls.id, semester: plan.semester, subjectIds: plan.subjectIds };

    for (const subjectId of plan.subjectIds) {
      await prisma.class_subjects.upsert({
        where: { class_id_subject_id_semester: { class_id: cls.id, subject_id: subjectId, semester: plan.semester } },
        update: {},
        create: { class_id: cls.id, subject_id: subjectId, semester: plan.semester, is_elective: false },
      });
    }
  }
  console.log('   classes ready:', Object.fromEntries(Object.entries(classByBatch).map(([k, v]) => [k, v.id])));

  // ---- 4. 500 students, 100 per batch ----
  console.log('4. 500 CSE test students (100 per batch)...');
  let totalStudentsCreated = 0;
  const studentIdsByBatch: Record<string, number[]> = {};
  for (const plan of BATCH_PLANS) {
    const cls = classByBatch[plan.batchName];
    const batchId = batchRows[plan.batchName];
    studentIdsByBatch[plan.batchName] = [];

    for (let i = 1; i <= 100; i++) {
      const idx = String(i).padStart(3, '0');
      const email = `student.cse.${plan.startYear}.${idx}@erp.test`;
      const studentIdNo = `TCSE${plan.startYear}${idx}`;

      const userId = await upsertUser(email, studentRoleId);
      let student = await prisma.students.findUnique({ where: { student_id_no: studentIdNo } });
      if (!student) {
        const [firstName] = nameFor(i).split(' ');
        student = await prisma.students.create({
          data: {
            user_id: userId,
            student_id_no: studentIdNo,
            roll_no: studentIdNo,
            register_no: studentIdNo,
            admission_no: `ADM-TEST-${plan.startYear}-${idx}`,
            course_id: CSE_COURSE_ID,
            quota_id: QUOTA_ID,
            class_id: cls.id,
            batch_id: batchId,
            admission_date: new Date(`${plan.startYear}-06-15`),
            admission_type: 'regular',
            joined_academic_year: plan.batchName,
            gender: i % 2 === 0 ? 'Male' : 'Female',
            date_of_birth: new Date(`${plan.startYear - 18}-0${(i % 9) + 1}-1${i % 9}`),
            student_type: i % 3 === 0 ? 'hosteller' : 'dayscholar',
            dayscholar_mode: i % 3 === 0 ? null : 'transport',
            status: 'active',
            nationality: 'Indian',
            joined_through: 'TNEA Counselling',
          },
        });
        totalStudentsCreated++;
      }
      studentIdsByBatch[plan.batchName].push(student.id);

      // Parent account + mapping (parent/guardian requirement).
      const parentEmail = `parent.cse.${plan.startYear}.${idx}@erp.test`;
      const parentUserId = await upsertUser(parentEmail, parentRoleId);
      const mappingExists = await prisma.parent_student_mapping.findFirst({
        where: { parent_user_id: parentUserId, student_id: student.id },
      });
      if (!mappingExists) {
        await prisma.parent_student_mapping.create({
          data: { parent_user_id: parentUserId, student_id: student.id, relationship: 'father' },
        });
      }
    }
    console.log(`   ${plan.batchName}: 100 students ready (class ${cls.id})`);
  }
  console.log(`   total NEW student rows created this run: ${totalStudentsCreated} (existing ones reused)`);

  // ---- 5. Four faculty responsibility test accounts ----
  console.log('5. Four faculty responsibility test accounts...');

  const advisorUserId = await upsertUser('cse.advisor.test@erp.test', facultyRoleId);
  const advisorFaculty = await upsertFaculty(advisorUserId, 'Test', 'Advisor', CSE_DEPT_ID, DESIGNATION_ASST_PROF, 'TESTADV001');
  const advisorClass = classByBatch['2026-2030']; // sem-1 test class
  await prisma.class_mentors.upsert({
    where: { class_id_academic_year: { class_id: advisorClass.id, academic_year: AY } },
    update: { faculty_id: advisorFaculty.id },
    create: { class_id: advisorClass.id, faculty_id: advisorFaculty.id, academic_year: AY },
  });
  console.log(`   CLASS ADVISOR ready - faculty_id=${advisorFaculty.id}, mentoring class ${advisorClass.id} (2026-2030 sem1)`);

  const subjectFacultyUserId = await upsertUser('cse.subjectfaculty.test@erp.test', facultyRoleId);
  const subjectFaculty = await upsertFaculty(subjectFacultyUserId, 'Test', 'SubjectFaculty', CSE_DEPT_ID, DESIGNATION_ASST_PROF, 'TESTSUB001');
  for (const subjectId of advisorClass.subjectIds.slice(0, 3)) {
    await prisma.faculty_subject_class_mapping.upsert({
      where: { subject_id_class_id_academic_year: { subject_id: subjectId, class_id: advisorClass.id, academic_year: AY } },
      update: { faculty_id: subjectFaculty.id },
      create: { subject_id: subjectId, class_id: advisorClass.id, faculty_id: subjectFaculty.id, academic_year: AY },
    });
  }
  console.log(`   SUBJECT HANDLING FACULTY ready - faculty_id=${subjectFaculty.id}, teaching 3 subjects in class ${advisorClass.id}`);

  const hodUserId = await upsertUser('cse.hod.test@erp.test', hodRoleId);
  const hodFaculty = await upsertFaculty(hodUserId, 'Test', 'Hod', CSE_DEPT_ID, DESIGNATION_ASSOC_PROF_HOD, 'TESTHOD001');
  console.log(`   CSE HOD ready - faculty_id=${hodFaculty.id}, department_id=${CSE_DEPT_ID} (role='hod' resolves department via this faculty row - see student-leaves.service.ts's resolveFacultyByUserId, no separate HOD mapping table exists)`);

  const hodFacultyUserId = await upsertUser('cse.hodfaculty.test@erp.test', hodRoleId);
  const hodFacultyFaculty = await upsertFaculty(hodFacultyUserId, 'Test', 'HodFaculty', CSE_DEPT_ID, DESIGNATION_ASSOC_PROF_HOD, 'TESTHODFAC001');
  const hodFacultyClass = classByBatch['2024-2028']; // sem-5 test class - deliberately different from advisor's, for variety
  for (const subjectId of hodFacultyClass.subjectIds.slice(0, 2)) {
    await prisma.faculty_subject_class_mapping.upsert({
      where: { subject_id_class_id_academic_year: { subject_id: subjectId, class_id: hodFacultyClass.id, academic_year: AY } },
      update: { faculty_id: hodFacultyFaculty.id },
      create: { subject_id: subjectId, class_id: hodFacultyClass.id, faculty_id: hodFacultyFaculty.id, academic_year: AY },
    });
  }
  console.log(`   HOD + SUBJECT HANDLING FACULTY ready - faculty_id=${hodFacultyFaculty.id}, HOD of dept ${CSE_DEPT_ID} AND teaching 2 subjects in class ${hodFacultyClass.id}`);

  // ---- 6. Attendance (advisor's class, its 3 subject-faculty-mapped subjects, 10 school days) ----
  console.log('6. Attendance records...');
  const attendanceRows: any[] = [];
  const today = new Date('2026-09-22');
  const schoolDays: Date[] = [];
  for (let d = 0; schoolDays.length < 10; d++) {
    const day = new Date(today);
    day.setDate(day.getDate() - d);
    if (day.getDay() !== 0 && day.getDay() !== 6) schoolDays.push(day); // skip weekends
  }
  const attendanceSubjects = advisorClass.subjectIds.slice(0, 3);
  for (const studentId of studentIdsByBatch['2026-2030']) {
    for (const subjectId of attendanceSubjects) {
      for (const day of schoolDays) {
        const roll = (studentId + subjectId + day.getDate()) % 100;
        const status = roll < 85 ? 'present' : roll < 95 ? 'absent' : 'on_duty';
        attendanceRows.push({
          student_id: studentId,
          class_id: advisorClass.id,
          subject_id: subjectId,
          attendance_date: day,
          status,
          marked_by_faculty_id: subjectFaculty.id,
          marked_by_user_id: subjectFacultyUserId,
          is_published: true,
        });
      }
    }
  }
  const attResult = await prisma.attendance_records.createMany({ data: attendanceRows, skipDuplicates: true });
  console.log(`   attendance rows attempted: ${attendanceRows.length}, inserted: ${attResult.count}`);

  // ---- 7. Student Leave + OD for advisor's class ----
  console.log('7. Student leave + OD requests...');
  const advisorStudents = studentIdsByBatch['2026-2030'];
  const leaveStatuses: { status: string; approved_by_faculty_id?: number }[] = [
    { status: 'pending' },
    { status: 'pending' },
    { status: 'faculty_approved', approved_by_faculty_id: advisorFaculty.id },
    { status: 'hod_approved', approved_by_faculty_id: advisorFaculty.id },
    { status: 'rejected' },
  ];
  let leaveCount = 0;
  for (let i = 0; i < leaveStatuses.length; i++) {
    const studentId = advisorStudents[i];
    const existing = await prisma.student_leaves.findFirst({ where: { student_id: studentId, reason: 'Seeded test leave request' } });
    if (existing) continue;
    await prisma.student_leaves.create({
      data: {
        student_id: studentId,
        from_date: new Date('2026-09-25'),
        to_date: new Date('2026-09-26'),
        reason: 'Seeded test leave request',
        status: leaveStatuses[i].status as any,
        approved_by_faculty_id: leaveStatuses[i].approved_by_faculty_id ?? null,
      },
    });
    leaveCount++;
  }
  console.log(`   student_leaves created: ${leaveCount}`);

  const odTeamExists = await prisma.od_teams.findFirst({ where: { unique_code: 'TESTOD01' } });
  if (!odTeamExists) {
    const odTeam = await prisma.od_teams.create({
      data: {
        created_by_student_id: advisorStudents[0],
        unique_code: 'TESTOD01',
        is_locked: true,
        team_name: 'Seeded Test OD Team',
        reason: 'Inter-college hackathon',
        venue: 'Off-campus',
        from_date: new Date('2026-09-28'),
        to_date: new Date('2026-09-29'),
      },
    });
    await prisma.od_team_members.createMany({
      data: [0, 1, 2].map((i) => ({ team_id: odTeam.id, student_id: advisorStudents[i] })),
      skipDuplicates: true,
    });
    await prisma.od_requests.create({
      data: {
        team_id: odTeam.id,
        from_date: new Date('2026-09-28'),
        to_date: new Date('2026-09-29'),
        reason: 'Inter-college hackathon',
        mentor_approval_status: 'pending',
      },
    });
    console.log('   OD team + request created');
  } else {
    console.log('   OD team already exists - reused');
  }

  // ---- 8. CIA1 marks for advisor's class ----
  console.log('8. CIA1 marks...');
  let cia1Exam = await prisma.exams.findFirst({ where: { exam_type_id: CIA1_EXAM_TYPE_ID, batch_id: batchRows['2026-2030'], academic_year: AY, semester: 1 } });
  if (!cia1Exam) {
    cia1Exam = await prisma.exams.create({
      data: { exam_type_id: CIA1_EXAM_TYPE_ID, batch_id: batchRows['2026-2030'], academic_year: AY, semester: 1, status: 'results_published', title: 'CIA 1 - Sem 1' },
    });
  }

  let ciaMarksCount = 0;
  for (const subjectId of attendanceSubjects) {
    const mapping = await prisma.exam_subject_mapping.upsert({
      where: { exam_id_class_id_subject_id: { exam_id: cia1Exam.id, class_id: advisorClass.id, subject_id: subjectId } },
      update: {},
      create: { exam_id: cia1Exam.id, class_id: advisorClass.id, subject_id: subjectId, is_published: true },
    });
    const rows = advisorStudents.map((studentId, i) => ({
      exam_subject_mapping_id: mapping.id,
      student_id: studentId,
      marks_obtained: 20 + ((studentId + subjectId + i) % 30), // 20-49 out of 50
      max_marks: 50,
      entered_by_faculty_id: subjectFaculty.id,
      is_absent: false,
    }));
    const res = await prisma.exam_marks.createMany({ data: rows, skipDuplicates: true });
    ciaMarksCount += res.count;
  }
  console.log(`   CIA1 exam_marks inserted: ${ciaMarksCount}`);

  // ---- 9. University end-semester result set (full class, all 6 subjects) - for SGPA/CGPA proof ----
  console.log('9. University semester result set (all 6 subjects, advisor class)...');
  let univExam = await prisma.exams.findFirst({ where: { exam_type_id: UNIV_END_EXAM_TYPE_ID, batch_id: batchRows['2026-2030'], academic_year: AY, semester: 1 } });
  if (!univExam) {
    univExam = await prisma.exams.create({
      data: { exam_type_id: UNIV_END_EXAM_TYPE_ID, batch_id: batchRows['2026-2030'], academic_year: AY, semester: 1, status: 'results_published', title: 'University End Semester Exam - Sem 1' },
    });
  }
  let univMarksCount = 0;
  for (const subjectId of advisorClass.subjectIds) {
    const mapping = await prisma.exam_subject_mapping.upsert({
      where: { exam_id_class_id_subject_id: { exam_id: univExam.id, class_id: advisorClass.id, subject_id: subjectId } },
      update: {},
      create: { exam_id: univExam.id, class_id: advisorClass.id, subject_id: subjectId, is_published: true },
    });
    // Deterministic per-student percentage (55-95%) so grade/grade-point are
    // internally consistent across every subject for the same student (a
    // stronger student scores consistently higher across all 6 subjects,
    // not randomly per-row) - keeps SGPA meaningful rather than noise.
    const rows = advisorStudents.map((studentId, i) => {
      const pct = 55 + (i % 41); // 55-95
      return {
        exam_subject_mapping_id: mapping.id,
        student_id: studentId,
        marks_obtained: pct,
        max_marks: 100,
        entered_by_faculty_id: subjectFaculty.id,
        is_absent: false,
      };
    });
    const res = await prisma.exam_marks.createMany({ data: rows, skipDuplicates: true });
    univMarksCount += res.count;
  }
  console.log(`   University exam_marks inserted: ${univMarksCount} (across all 6 sem-1 subjects x 100 students)`);

  // ---- 10. Assignments for advisor's class ----
  console.log('10. Assignments...');
  let assignmentCount = 0;
  for (const [seqIdx, subjectId] of attendanceSubjects.entries()) {
    const assignment = await prisma.assignments.upsert({
      where: { class_id_subject_id_academic_year_semester_sequence_no: { class_id: advisorClass.id, subject_id: subjectId, academic_year: AY, semester: 1, sequence_no: 1 } },
      update: {},
      create: {
        class_id: advisorClass.id,
        subject_id: subjectId,
        faculty_id: subjectFaculty.id,
        academic_year: AY,
        semester: 1,
        sequence_no: 1,
        title: 'Seeded Unit 1 Assignment',
        description: 'Test assignment seeded for verification.',
        due_date: new Date('2026-09-30'),
        max_marks: 10,
        task_type: 'assignment',
      },
    });
    const statusRows = advisorStudents.map((studentId, i) => ({
      assignment_id: assignment.id,
      student_id: studentId,
      is_submitted: i % 3 !== 0, // ~2/3 submitted, 1/3 pending
      submitted_at: i % 3 !== 0 ? new Date('2026-09-29') : null,
      marks_obtained: i % 3 !== 0 ? 5 + (i % 6) : null,
    }));
    const res = await prisma.student_assignment_status.createMany({ data: statusRows, skipDuplicates: true });
    assignmentCount += res.count;
    void seqIdx;
  }
  console.log(`   student_assignment_status rows inserted: ${assignmentCount}`);

  // ---- 11. LMS materials (folder + resource) for advisor's class subjects ----
  console.log('11. LMS materials...');
  let lmsFolderCount = 0;
  for (const subjectId of attendanceSubjects) {
    let folder = await prisma.lms_folders.findFirst({ where: { subject_id: subjectId, faculty_id: subjectFaculty.id, title: 'Seeded Unit 1 Notes' } });
    if (!folder) {
      folder = await prisma.lms_folders.create({
        data: { subject_id: subjectId, faculty_id: subjectFaculty.id, title: 'Seeded Unit 1 Notes', description: 'Test LMS folder seeded for verification.' },
      });
      lmsFolderCount++;
    }
    await prisma.lms_folder_classes.upsert({
      where: { folder_id_class_id: { folder_id: folder.id, class_id: advisorClass.id } },
      update: {},
      create: { folder_id: folder.id, class_id: advisorClass.id },
    });
    const resourceExists = await prisma.lms_resources.findFirst({ where: { folder_id: folder.id, title: 'Unit 1 Slides' } });
    if (!resourceExists) {
      await prisma.lms_resources.create({
        data: { folder_id: folder.id, title: 'Unit 1 Slides', resource_type: 'link', link_url: 'https://example.com/seeded-notes.pdf', uploaded_by_user_id: subjectFacultyUserId },
      });
    }
  }
  console.log(`   LMS folders created this run: ${lmsFolderCount}`);

  // ---- 12. Timetable for advisor's class ----
  console.log('12. Timetable...');
  let timetableCount = 0;
  for (const [i, subjectId] of attendanceSubjects.entries()) {
    const existing = await prisma.timetable_slots.findFirst({
      where: { class_id: advisorClass.id, day_of_week: 1, period_number: i + 1, academic_year: AY },
    });
    if (!existing) {
      await prisma.timetable_slots.create({
        data: {
          class_id: advisorClass.id,
          subject_id: subjectId,
          faculty_id: subjectFaculty.id,
          day_of_week: 1,
          period_number: i + 1,
          start_time: new Date(`1970-01-01T${String(9 + i).padStart(2, '0')}:00:00Z`),
          end_time: new Date(`1970-01-01T${String(9 + i).padStart(2, '0')}:50:00Z`),
          academic_year: AY,
          semester: 1,
        },
      });
      timetableCount++;
    }
  }
  console.log(`   timetable_slots created this run: ${timetableCount}`);

  // ---- 13. Announcements (class + department scope) ----
  console.log('13. Announcements...');
  const announceExists1 = await prisma.announcements.findFirst({ where: { title: 'Seeded Test Class Announcement' } });
  if (!announceExists1) {
    const ann = await prisma.announcements.create({
      data: {
        posted_by_user_id: advisorUserId,
        title: 'Seeded Test Class Announcement',
        content: 'This is a seeded announcement for the advisor test class, for verification purposes.',
        target_audience: 'students',
        status: 'published',
        category: 'academic',
      },
    });
    await prisma.announcement_class_mapping.create({ data: { announcement_id: ann.id, class_id: advisorClass.id } });
  }
  const announceExists2 = await prisma.announcements.findFirst({ where: { title: 'Seeded Test Department Announcement' } });
  if (!announceExists2) {
    await prisma.announcements.create({
      data: {
        posted_by_user_id: hodUserId,
        title: 'Seeded Test Department Announcement',
        content: 'This is a seeded department-wide announcement from the CSE HOD test account.',
        target_audience: 'students',
        department_id: CSE_DEPT_ID,
        status: 'published',
        category: 'department',
      },
    });
  }
  console.log('   announcements ready');

  // ---- 14. Placements (drive + applications for advisor's class) ----
  console.log('14. Placements...');
  let company = await prisma.companies.findFirst({ where: { name: 'Seeded Test Technologies' } });
  if (!company) company = await prisma.companies.create({ data: { name: 'Seeded Test Technologies', profile_info: 'Test company seeded for verification.' } });
  let drive = await prisma.placement_drives.findFirst({ where: { company_id: company.id } });
  if (!drive) {
    drive = await prisma.placement_drives.create({
      data: {
        company_id: company.id,
        scheduled_date: new Date('2026-10-15'),
        job_role: 'Software Engineer',
        package_lpa: 6.5,
        eligibility_cgpa: 6.0,
        venue: 'Main Auditorium',
      },
    });
  }
  let placementAppCount = 0;
  for (const studentId of advisorStudents.slice(0, 20)) {
    const exists = await prisma.student_drive_applications.findUnique({ where: { drive_id_student_id: { drive_id: drive.id, student_id: studentId } } });
    if (!exists) {
      await prisma.student_drive_applications.create({ data: { drive_id: drive.id, student_id: studentId, status: 'applied' } });
      placementAppCount++;
    }
  }
  console.log(`   placement drive applications created this run: ${placementAppCount}`);

  console.log('\n=== Phase 1 seed complete ===');

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error('SEED FAILED:', e);
  await prisma.$disconnect();
  process.exit(1);
});
