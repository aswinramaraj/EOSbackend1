/**
 * Comprehensive CSE test-data seed - Phase 2.
 *
 * User ask: for CSE batches 2023-2027 and 2024-2028, seed at least 2 classes
 * per batch of 25 students each with FULL data (attendance, all exams'
 * marks, leaves, OD, assignments, LMS, timetable, announcements,
 * placements) - mirroring what Phase 1 (seed-cse-comprehensive.ts) already
 * did for the 2026-2030 batch's class 1285 only.
 *
 * Phase 1 already created 100 test students per batch under one section
 * 'Z' class (1288 for 2023-2027, 1287 for 2024-2028) but never seeded any
 * records for them. Rather than creating 100 new logins, this script
 * REUSES 50 of those already-existing students per batch, splitting them
 * into two new dedicated classes (sections 'Z1'/'Z2', 25 students each) so
 * the HOD's Class Records page has two real per-batch classes to filter
 * between. The other 50 students per batch are left untouched in the
 * original Z class.
 *
 * Additive, idempotent, safely rerunnable. Same password convention as
 * Phase 1 (sha256 hex, not bcrypt) - not touched here, these are existing
 * users.
 *
 * Run: npx ts-node prisma/seed-cse-2324-2428-splitclasses.ts
 */
import 'dotenv/config';
import { PrismaClient } from '../generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter } as any) as any;

const CSE_DEPT_ID = 75;
const CSE_COURSE_ID = 73;
const AY = '2026-2027';
const CIA1_EXAM_TYPE_ID = 25;
const UNIV_END_EXAM_TYPE_ID = 28;

const SEM5_SUBJECTS = [1693, 1694, 1695, 1696, 1697, 1698]; // CS501-506 (2024-2028, sem 5)
const SEM7_SUBJECTS = [1699, 1700, 1701, 1702, 1703, 1704]; // CS701-706 (2023-2027, sem 7)

type BatchPlan = {
  batchName: string;
  batchId: number;
  sourceClassId: number; // existing 100-student 'Z' class to draw students from
  semester: number;
  subjectIds: number[];
};

const BATCH_PLANS: BatchPlan[] = [
  { batchName: '2024-2028', batchId: 55, sourceClassId: 1287, semester: 5, subjectIds: SEM5_SUBJECTS },
  { batchName: '2023-2027', batchId: 54, sourceClassId: 1288, semester: 7, subjectIds: SEM7_SUBJECTS },
];

function schoolDays(count: number, from: Date): Date[] {
  const days: Date[] = [];
  for (let d = 0; days.length < count; d++) {
    const day = new Date(from);
    day.setDate(day.getDate() - d);
    if (day.getDay() !== 0 && day.getDay() !== 6) days.push(day);
  }
  return days;
}

async function seedClass(opts: {
  classId: number;
  className: string;
  batchName: string;
  semester: number;
  subjectIds: number[];
  studentIds: number[];
  advisorFacultyId: number;
  advisorUserId: number;
  subjectFacultyId: number;
  subjectFacultyUserId: number;
  hodUserId: number;
}) {
  const {
    classId, className, batchName, semester, subjectIds, studentIds,
    advisorFacultyId, advisorUserId, subjectFacultyId, subjectFacultyUserId, hodUserId,
  } = opts;
  const label = `${batchName} ${className} (class ${classId})`;
  const attendanceSubjects = subjectIds.slice(0, 3);

  // class_mentors
  await prisma.class_mentors.upsert({
    where: { class_id_academic_year: { class_id: classId, academic_year: AY } },
    update: { faculty_id: advisorFacultyId },
    create: { class_id: classId, faculty_id: advisorFacultyId, academic_year: AY },
  });

  // faculty_subject_class_mapping (all 6 subjects to the subject-faculty test account)
  for (const subjectId of subjectIds) {
    await prisma.faculty_subject_class_mapping.upsert({
      where: { subject_id_class_id_academic_year: { subject_id: subjectId, class_id: classId, academic_year: AY } },
      update: { faculty_id: subjectFacultyId },
      create: { subject_id: subjectId, class_id: classId, faculty_id: subjectFacultyId, academic_year: AY },
    });
  }

  // Attendance - 10 school days x 3 subjects x 25 students
  const attendanceRows: any[] = [];
  for (const studentId of studentIds) {
    for (const subjectId of attendanceSubjects) {
      for (const day of schoolDays(10, new Date('2026-09-22'))) {
        const roll = (studentId + subjectId + day.getDate()) % 100;
        const status = roll < 85 ? 'present' : roll < 95 ? 'absent' : 'on_duty';
        attendanceRows.push({
          student_id: studentId,
          class_id: classId,
          subject_id: subjectId,
          attendance_date: day,
          status,
          marked_by_faculty_id: subjectFacultyId,
          marked_by_user_id: subjectFacultyUserId,
          is_published: true,
        });
      }
    }
  }
  const attResult = await prisma.attendance_records.createMany({ data: attendanceRows, skipDuplicates: true });
  console.log(`   [${label}] attendance inserted: ${attResult.count}/${attendanceRows.length}`);

  // Student leaves (first 5 students)
  let leaveCount = 0;
  const leaveStatuses = [
    { status: 'pending' },
    { status: 'pending' },
    { status: 'faculty_approved', approved_by_faculty_id: advisorFacultyId },
    { status: 'hod_approved', approved_by_faculty_id: advisorFacultyId },
    { status: 'rejected' },
  ];
  for (let i = 0; i < leaveStatuses.length && i < studentIds.length; i++) {
    const studentId = studentIds[i];
    const marker = `Seeded test leave request (${className})`;
    const existing = await prisma.student_leaves.findFirst({ where: { student_id: studentId, reason: marker } });
    if (existing) continue;
    await prisma.student_leaves.create({
      data: {
        student_id: studentId,
        from_date: new Date('2026-09-25'),
        to_date: new Date('2026-09-26'),
        reason: marker,
        status: leaveStatuses[i].status as any,
        approved_by_faculty_id: (leaveStatuses[i] as any).approved_by_faculty_id ?? null,
      },
    });
    leaveCount++;
  }
  console.log(`   [${label}] student_leaves created: ${leaveCount}`);

  // OD team + request (first 3 students)
  const odCode = `TESTOD${classId}`;
  const odExists = await prisma.od_teams.findFirst({ where: { unique_code: odCode } });
  if (!odExists) {
    const odTeam = await prisma.od_teams.create({
      data: {
        created_by_student_id: studentIds[0],
        unique_code: odCode,
        is_locked: true,
        team_name: `Seeded Test OD Team (${className})`,
        reason: 'Inter-college hackathon',
        venue: 'Off-campus',
        from_date: new Date('2026-09-28'),
        to_date: new Date('2026-09-29'),
      },
    });
    await prisma.od_team_members.createMany({
      data: [0, 1, 2].map((i) => ({ team_id: odTeam.id, student_id: studentIds[i] })),
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
    console.log(`   [${label}] OD team + request created`);
  }

  // CIA1 marks (3 subjects, 25 students)
  let cia1Exam = await prisma.exams.findFirst({
    where: { exam_type_id: CIA1_EXAM_TYPE_ID, batch_id: opts.batchName === '2024-2028' ? 55 : 54, academic_year: AY, semester },
  });
  if (!cia1Exam) {
    cia1Exam = await prisma.exams.create({
      data: {
        exam_type_id: CIA1_EXAM_TYPE_ID,
        batch_id: opts.batchName === '2024-2028' ? 55 : 54,
        academic_year: AY,
        semester,
        status: 'results_published',
        title: `CIA 1 - Sem ${semester}`,
      },
    });
  }
  let ciaMarksCount = 0;
  for (const subjectId of attendanceSubjects) {
    const mapping = await prisma.exam_subject_mapping.upsert({
      where: { exam_id_class_id_subject_id: { exam_id: cia1Exam.id, class_id: classId, subject_id: subjectId } },
      update: {},
      create: { exam_id: cia1Exam.id, class_id: classId, subject_id: subjectId, is_published: true },
    });
    const rows = studentIds.map((studentId, i) => ({
      exam_subject_mapping_id: mapping.id,
      student_id: studentId,
      marks_obtained: 20 + ((studentId + subjectId + i) % 30),
      max_marks: 50,
      entered_by_faculty_id: subjectFacultyId,
      is_absent: false,
    }));
    const res = await prisma.exam_marks.createMany({ data: rows, skipDuplicates: true });
    ciaMarksCount += res.count;
  }
  console.log(`   [${label}] CIA1 exam_marks inserted: ${ciaMarksCount}`);

  // University end-semester result set (all 6 subjects, 25 students)
  let univExam = await prisma.exams.findFirst({
    where: { exam_type_id: UNIV_END_EXAM_TYPE_ID, batch_id: opts.batchName === '2024-2028' ? 55 : 54, academic_year: AY, semester },
  });
  if (!univExam) {
    univExam = await prisma.exams.create({
      data: {
        exam_type_id: UNIV_END_EXAM_TYPE_ID,
        batch_id: opts.batchName === '2024-2028' ? 55 : 54,
        academic_year: AY,
        semester,
        status: 'results_published',
        title: `University End Semester Exam - Sem ${semester}`,
      },
    });
  }
  let univMarksCount = 0;
  for (const subjectId of subjectIds) {
    const mapping = await prisma.exam_subject_mapping.upsert({
      where: { exam_id_class_id_subject_id: { exam_id: univExam.id, class_id: classId, subject_id: subjectId } },
      update: {},
      create: { exam_id: univExam.id, class_id: classId, subject_id: subjectId, is_published: true },
    });
    const rows = studentIds.map((studentId, i) => {
      const pct = 55 + (i % 41);
      return {
        exam_subject_mapping_id: mapping.id,
        student_id: studentId,
        marks_obtained: pct,
        max_marks: 100,
        entered_by_faculty_id: subjectFacultyId,
        is_absent: false,
      };
    });
    const res = await prisma.exam_marks.createMany({ data: rows, skipDuplicates: true });
    univMarksCount += res.count;
  }
  console.log(`   [${label}] University exam_marks inserted: ${univMarksCount}`);

  // Assignments (3 subjects)
  let assignmentCount = 0;
  for (const subjectId of attendanceSubjects) {
    const assignment = await prisma.assignments.upsert({
      where: {
        class_id_subject_id_academic_year_semester_sequence_no: {
          class_id: classId, subject_id: subjectId, academic_year: AY, semester, sequence_no: 1,
        },
      },
      update: {},
      create: {
        class_id: classId,
        subject_id: subjectId,
        faculty_id: subjectFacultyId,
        academic_year: AY,
        semester,
        sequence_no: 1,
        title: 'Seeded Unit 1 Assignment',
        description: 'Test assignment seeded for verification.',
        due_date: new Date('2026-09-30'),
        max_marks: 10,
        task_type: 'assignment',
      },
    });
    const statusRows = studentIds.map((studentId, i) => ({
      assignment_id: assignment.id,
      student_id: studentId,
      is_submitted: i % 3 !== 0,
      submitted_at: i % 3 !== 0 ? new Date('2026-09-29') : null,
      marks_obtained: i % 3 !== 0 ? 5 + (i % 6) : null,
    }));
    const res = await prisma.student_assignment_status.createMany({ data: statusRows, skipDuplicates: true });
    assignmentCount += res.count;
  }
  console.log(`   [${label}] student_assignment_status inserted: ${assignmentCount}`);

  // LMS materials (3 subjects)
  for (const subjectId of attendanceSubjects) {
    let folder = await prisma.lms_folders.findFirst({
      where: { subject_id: subjectId, faculty_id: subjectFacultyId, title: 'Seeded Unit 1 Notes' },
    });
    if (!folder) {
      folder = await prisma.lms_folders.create({
        data: { subject_id: subjectId, faculty_id: subjectFacultyId, title: 'Seeded Unit 1 Notes', description: 'Test LMS folder seeded for verification.' },
      });
    }
    await prisma.lms_folder_classes.upsert({
      where: { folder_id_class_id: { folder_id: folder.id, class_id: classId } },
      update: {},
      create: { folder_id: folder.id, class_id: classId },
    });
    const resourceExists = await prisma.lms_resources.findFirst({ where: { folder_id: folder.id, title: 'Unit 1 Slides' } });
    if (!resourceExists) {
      await prisma.lms_resources.create({
        data: { folder_id: folder.id, title: 'Unit 1 Slides', resource_type: 'link', link_url: 'https://example.com/seeded-notes.pdf', uploaded_by_user_id: subjectFacultyUserId },
      });
    }
  }
  console.log(`   [${label}] LMS materials ready`);

  // Timetable (3 subjects, periods 1-3, Monday)
  let timetableCount = 0;
  for (const [i, subjectId] of attendanceSubjects.entries()) {
    const existing = await prisma.timetable_slots.findFirst({
      where: { class_id: classId, day_of_week: 1, period_number: i + 1, academic_year: AY },
    });
    if (!existing) {
      await prisma.timetable_slots.create({
        data: {
          class_id: classId,
          subject_id: subjectId,
          faculty_id: subjectFacultyId,
          day_of_week: 1,
          period_number: i + 1,
          start_time: new Date(`1970-01-01T${String(9 + i).padStart(2, '0')}:00:00Z`),
          end_time: new Date(`1970-01-01T${String(9 + i).padStart(2, '0')}:50:00Z`),
          academic_year: AY,
          semester,
        },
      });
      timetableCount++;
    }
  }
  console.log(`   [${label}] timetable_slots created: ${timetableCount}`);

  // Announcements
  const classAnnounceTitle = `Seeded Test Class Announcement (${label})`;
  const classAnnounceExists = await prisma.announcements.findFirst({ where: { title: classAnnounceTitle } });
  if (!classAnnounceExists) {
    const ann = await prisma.announcements.create({
      data: {
        posted_by_user_id: advisorUserId,
        title: classAnnounceTitle,
        content: `This is a seeded announcement for ${label}, for verification purposes.`,
        target_audience: 'students',
        status: 'published',
        category: 'academic',
      },
    });
    await prisma.announcement_class_mapping.create({ data: { announcement_id: ann.id, class_id: classId } });
  }

  // Placements - reuse the shared "Seeded Test Technologies" drive
  const company = await prisma.companies.findFirst({ where: { name: 'Seeded Test Technologies' } });
  if (company) {
    const drive = await prisma.placement_drives.findFirst({ where: { company_id: company.id } });
    if (drive) {
      let placementAppCount = 0;
      for (const studentId of studentIds.slice(0, 15)) {
        const exists = await prisma.student_drive_applications.findUnique({
          where: { drive_id_student_id: { drive_id: drive.id, student_id: studentId } },
        });
        if (!exists) {
          await prisma.student_drive_applications.create({ data: { drive_id: drive.id, student_id: studentId, status: 'applied' } });
          placementAppCount++;
        }
      }
      console.log(`   [${label}] placement applications created: ${placementAppCount}`);
    }
  }

  void hodUserId;
}

async function main() {
  console.log('=== Phase 2: CSE 2023-2027 / 2024-2028 - split classes + full data ===\n');

  const advisorUser = await prisma.users.findUnique({ where: { email: 'cse.advisor.test@erp.test' } });
  const advisorFaculty = await prisma.faculty.findUnique({ where: { user_id: advisorUser.id } });
  const subjectFacultyUser = await prisma.users.findUnique({ where: { email: 'cse.subjectfaculty.test@erp.test' } });
  const subjectFaculty = await prisma.faculty.findUnique({ where: { user_id: subjectFacultyUser.id } });
  const hodUser = await prisma.users.findUnique({ where: { email: 'cse.hod.test@erp.test' } });

  console.log(`advisor faculty_id=${advisorFaculty.id}, subject faculty_id=${subjectFaculty.id}, hod user_id=${hodUser.id}\n`);

  for (const plan of BATCH_PLANS) {
    console.log(`--- Batch ${plan.batchName} (source class ${plan.sourceClassId}, sem ${plan.semester}) ---`);

    const sourceStudents = await prisma.students.findMany({
      where: { class_id: plan.sourceClassId },
      orderBy: { id: 'asc' },
      select: { id: true },
    });
    if (sourceStudents.length < 50) {
      throw new Error(`Expected >=50 students in source class ${plan.sourceClassId}, found ${sourceStudents.length}`);
    }
    const group1 = sourceStudents.slice(0, 25).map((s: any) => s.id);
    const group2 = sourceStudents.slice(25, 50).map((s: any) => s.id);

    for (const [section, studentIds] of [['Z1', group1], ['Z2', group2]] as [string, number[]][]) {
      const cls = await prisma.classes.upsert({
        where: { batch_id_course_id_section: { batch_id: plan.batchId, course_id: CSE_COURSE_ID, section } },
        update: { current_semester: plan.semester },
        create: {
          batch_id: plan.batchId,
          department_id: CSE_DEPT_ID,
          course_id: CSE_COURSE_ID,
          section,
          current_semester: plan.semester,
          classroom: `Test Block - Room ${section}`,
        },
      });
      console.log(`   class ${section} ready: id=${cls.id}`);

      for (const subjectId of plan.subjectIds) {
        await prisma.class_subjects.upsert({
          where: { class_id_subject_id_semester: { class_id: cls.id, subject_id: subjectId, semester: plan.semester } },
          update: {},
          create: { class_id: cls.id, subject_id: subjectId, semester: plan.semester, is_elective: false },
        });
      }

      // Move these 25 students into the new class.
      await prisma.students.updateMany({
        where: { id: { in: studentIds } },
        data: { class_id: cls.id },
      });
      console.log(`   moved ${studentIds.length} students into class ${cls.id} (${section})`);

      await seedClass({
        classId: cls.id,
        className: section,
        batchName: plan.batchName,
        semester: plan.semester,
        subjectIds: plan.subjectIds,
        studentIds,
        advisorFacultyId: advisorFaculty.id,
        advisorUserId: advisorUser.id,
        subjectFacultyId: subjectFaculty.id,
        subjectFacultyUserId: subjectFacultyUser.id,
        hodUserId: hodUser.id,
      });
    }
  }

  console.log('\n=== Phase 2 seed complete ===');
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error('SEED FAILED:', e);
  await prisma.$disconnect();
  process.exit(1);
});
