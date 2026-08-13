// One-off, additive test-data script — NOT part of the application backend
// code. Mirrors exactly what prisma/seed.ts already does for hod@eos.test
// and hr_payroll@eos.test (give the seeded role account a faculty row), but
// that script left faculty@eos.test itself without one, so every faculty
// self-service endpoint 404s "Faculty profile not found" for it. This adds
// a faculty row + a class_mentors row so the Advisor frontend's "MY CLASS"
// group and every other faculty page can be exercised end-to-end.
import 'dotenv/config';
import { PrismaClient } from '../generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  const facultyUser = await prisma.users.findUnique({ where: { email: 'faculty@eos.test' } });
  if (!facultyUser) throw new Error('faculty@eos.test not found — run npm run seed first');

  let faculty = await prisma.faculty.findUnique({ where: { user_id: facultyUser.id } });
  if (!faculty) {
    const dept = await prisma.departments.findFirst({ orderBy: { id: 'asc' } });
    if (!dept) throw new Error('No departments exist');
    faculty = await prisma.faculty.create({
      data: {
        user_id: facultyUser.id,
        first_name: 'Test',
        last_name: 'Faculty',
        designation: 'Assistant Professor',
        department_id: dept.id,
        status: 'active',
        date_of_joining: new Date('2020-06-01'),
        office_room: 'Block C · Room 214',
        qualification: 'M.E.',
      },
    });
    console.log(`Created faculty.id=${faculty.id}, department_id=${faculty.department_id}`);
  } else {
    console.log(`Faculty row already exists: faculty.id=${faculty.id}`);
  }

  // Also give this faculty a class_mentors row for a real class, so the
  // frontend's "MY CLASS" advisor-gated nav group and Students/Leave/OD/
  // Placements pages can be exercised.
  const existingMentor = await prisma.class_mentors.findFirst({ where: { faculty_id: faculty.id } });
  if (existingMentor) {
    console.log(`class_mentors row already exists: id=${existingMentor.id}, class_id=${existingMentor.class_id}`);
  } else {
    const aClass = await prisma.classes.findFirst({ orderBy: { id: 'asc' } });
    if (!aClass) {
      console.log('No classes exist — skipping class_mentors row.');
    } else {
      const mentor = await prisma.class_mentors.upsert({
        where: { class_id_academic_year: { class_id: aClass.id, academic_year: '2025-26' } },
        update: { faculty_id: faculty.id },
        create: { class_id: aClass.id, faculty_id: faculty.id, academic_year: '2025-26' },
      });
      console.log(`Upserted class_mentors: id=${mentor.id}, class_id=${mentor.class_id}`);
    }
  }

  // Also map this faculty to a subject+class via faculty_subject_class_mapping
  // (what AssignmentsService.getHandledClasses reads), so
  // handled-classes/attendance/assignments/exams/subject-records aren't empty.
  const existingSubjMapping = await prisma.faculty_subject_class_mapping.findFirst({ where: { faculty_id: faculty.id } });
  if (existingSubjMapping) {
    console.log(`faculty_subject_class_mapping already exists: id=${existingSubjMapping.id}`);
  } else {
    const classSubject = await prisma.class_subjects.findFirst({ orderBy: { id: 'asc' } });
    if (!classSubject) {
      console.log('No class_subjects rows exist — skipping faculty_subject_class_mapping.');
    } else {
      const subjMapping = await prisma.faculty_subject_class_mapping.upsert({
        where: { subject_id_class_id_academic_year: { subject_id: classSubject.subject_id, class_id: classSubject.class_id, academic_year: '2025-26' } },
        update: { faculty_id: faculty.id },
        create: { faculty_id: faculty.id, subject_id: classSubject.subject_id, class_id: classSubject.class_id, academic_year: '2025-26' },
      });
      console.log(`Upserted faculty_subject_class_mapping: id=${subjMapping.id}, subject_id=${subjMapping.subject_id}, class_id=${subjMapping.class_id}`);
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
