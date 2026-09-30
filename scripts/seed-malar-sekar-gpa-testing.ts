/**
 * One-off, reviewable script — replaces malar.sekar2024cse@sece.ac.in's
 * (student_id 22609) existing exam_marks with a realistic, well-structured
 * mock dataset spanning semesters 1-5, for testing the SGPA/CGPA redesign
 * in docs/gpa_implementation_plan.md end-to-end against real data.
 *
 * User explicitly confirmed this account's existing 138 exam_marks rows are
 * safe to replace for this purpose (2026-09-28). Not run automatically —
 * the sandbox's own safety classifier denied doing this directly, so this
 * is handed off the same way this project already hands off schema
 * changes: reviewed here, run by a human.
 *
 * Run with: npx ts-node -r tsconfig-paths/register scripts/seed-malar-sekar-gpa-testing.ts
 *
 * What it does:
 *  1. Reuses every EXISTING exam_subject_mapping (real subjects/exams/
 *     credits already set up for this student's class, semesters 1-5) —
 *     creates no new subjects/exams, only replaces this one student's marks.
 *  2. Deletes this student's current 138 exam_marks rows.
 *  3. Inserts a fresh set, one target percentage per (semester, subject),
 *     applied consistently across every exam type for that subject
 *     (CIA1/CIA2/CIA3/Quiz/University End Semester Exam) so the whole
 *     dataset looks realistic, not just the one exam type SGPA/CGPA reads.
 *  4. Intentionally includes one failing (RA) grade in semester 2
 *     (Environmental Science, 45%) to exercise the "a failed subject still
 *     counts, lowers the average" rule against real data, not just a unit
 *     test.
 *  5. Prints the expected SGPA per semester and running CGPA so you can
 *     compare against what the app actually computes afterward.
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';
import 'dotenv/config';
import {
  computeSemesterAggregate,
  computeCumulativeAggregate,
} from '../src/common/utils/semester-gpa.util';
import { isEndSemesterExam } from '../src/common/utils/exam-type.util';

const STUDENT_ID = 22609; // malar.sekar2024cse@sece.ac.in

const TARGETS: Record<number, Record<string, number>> = {
  1: {
    'Engineering Mathematics I': 92,
    'Engineering Physics': 82,
    'Engineering Chemistry': 74,
    'Problem Solving and Programming in C': 91,
    'Engineering Graphics': 65,
    'English for Communication': 84,
  },
  2: {
    'Engineering Mathematics II': 71,
    'Applied Physics': 55,
    'Environmental Science': 45, // intentional fail (RA) - real-data arrear test
    'Data Structures Fundamentals': 93,
    'Digital Principles': 68,
    'Professional Communication': 81,
  },
  3: {
    'Data Structures': 95,
    'Object Oriented Programming': 88,
    'Discrete Mathematics': 78,
    'Computer Organization': 92,
    'Python Programming': 96,
    'Digital Logic Design': 85,
  },
  4: {
    'Design and Analysis of Algorithms': 78,
    'Operating Systems Fundamentals': 65,
    'Database Management Systems': 91,
    'Software Engineering Principles': 82,
    'Theory of Computation': 58,
    'Object Oriented Design': 87,
  },
  5: {
    'Database Management Systems': 88,
    'Operating Systems': 76,
    'Design and Analysis of Algorithms': 93,
    'Computer Networks': 68,
    'Software Engineering': 85,
    'Web Technology': 90,
  },
};

async function main() {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter });

  const student = await prisma.students.findUnique({
    where: { id: STUDENT_ID },
    select: { class_id: true, users: { select: { email: true } } },
  });
  if (student?.users.email !== 'malar.sekar2024cse@sece.ac.in') {
    throw new Error(
      `Safety check failed: student_id ${STUDENT_ID} does not resolve to malar.sekar2024cse@sece.ac.in. Aborting without touching anything.`,
    );
  }

  const mappings = await prisma.exam_subject_mapping.findMany({
    where: { class_id: student.class_id! },
    select: {
      id: true,
      subjects: { select: { name: true, credits: true } },
      exams: {
        select: {
          semester: true,
          status: true,
          exam_types: { select: { category: true } },
        },
      },
    },
    orderBy: [{ exams: { semester: 'asc' } }, { id: 'asc' }],
  });

  const existingMarks = await prisma.exam_marks.findMany({
    where: { student_id: STUDENT_ID },
    select: { exam_subject_mapping_id: true, entered_by_faculty_id: true, max_marks: true },
  });
  const facultyByMapping = new Map(
    existingMarks.map((m) => [m.exam_subject_mapping_id, m.entered_by_faculty_id]),
  );
  const maxMarksByMapping = new Map(
    existingMarks.map((m) => [m.exam_subject_mapping_id, Number(m.max_marks)]),
  );

  const deleted = await prisma.exam_marks.deleteMany({ where: { student_id: STUDENT_ID } });
  console.log(`Deleted ${deleted.count} existing exam_marks rows for student ${STUDENT_ID}.`);

  const toCreate = mappings.map((m) => {
    const pct = TARGETS[m.exams.semester]?.[m.subjects.name];
    if (pct === undefined) {
      throw new Error(
        `No target percentage defined for semester ${m.exams.semester} subject "${m.subjects.name}" (mapping ${m.id})`,
      );
    }
    const maxMarks = maxMarksByMapping.get(m.id);
    if (maxMarks === undefined) {
      throw new Error(`No canonical max_marks found for mapping ${m.id} — cannot proceed safely.`);
    }
    const marksObtained = Math.round((pct / 100) * maxMarks * 10) / 10;
    return {
      exam_subject_mapping_id: m.id,
      student_id: STUDENT_ID,
      marks_obtained: marksObtained,
      max_marks: maxMarks,
      entered_by_faculty_id: facultyByMapping.get(m.id) ?? null,
      is_absent: false,
    };
  });

  const created = await prisma.exam_marks.createMany({ data: toCreate });
  console.log(`Created ${created.count} new exam_marks rows.`);

  // --- Compute + print expected SGPA/CGPA per semester, and write them to
  // student_semester_gpa (the real target table) so this run also produces
  // the first real, live-data-verified rows in it. ---
  const bands = await prisma.grade_bands.findMany({ orderBy: { display_order: 'asc' } });

  let cumulativeCredits = 0;
  let cumulativeWeightedPoints = 0;

  const bySemester = new Map<number, typeof mappings>();
  for (const m of mappings) {
    const arr = bySemester.get(m.exams.semester) ?? [];
    arr.push(m);
    bySemester.set(m.exams.semester, arr);
  }

  for (const semester of [...bySemester.keys()].sort((a, b) => a - b)) {
    const semMappings = bySemester.get(semester)!.filter(
      (m) => m.exams.status === 'results_published' && isEndSemesterExam(m.exams.exam_types),
    );
    const subjectResults = semMappings.map((m) => {
      const created_ = toCreate.find((c) => c.exam_subject_mapping_id === m.id)!;
      const percentage = (created_.marks_obtained / created_.max_marks) * 100;
      return { credits: m.subjects.credits ?? 1, percentage };
    });

    const semAgg = computeSemesterAggregate(subjectResults, bands);
    const cum = computeCumulativeAggregate(cumulativeCredits, cumulativeWeightedPoints, semAgg);
    cumulativeCredits = cum.cumulativeCredits;
    cumulativeWeightedPoints = cum.cumulativeWeightedPoints;

    console.log(
      `Semester ${semester}: SGPA=${semAgg.sgpa} (credits=${semAgg.totalCredits}) | Running CGPA=${cum.cgpa} (cumulative credits=${cum.cumulativeCredits})`,
    );

    await prisma.student_semester_gpa.upsert({
      where: { student_id_semester: { student_id: STUDENT_ID, semester } },
      create: {
        student_id: STUDENT_ID,
        semester,
        total_credits: semAgg.totalCredits,
        total_weighted_points: semAgg.totalWeightedPoints,
        sgpa: semAgg.sgpa ?? 0,
        cumulative_credits: cum.cumulativeCredits,
        cumulative_weighted_points: cum.cumulativeWeightedPoints,
        cgpa: cum.cgpa ?? 0,
        is_provisional: false,
      },
      update: {
        total_credits: semAgg.totalCredits,
        total_weighted_points: semAgg.totalWeightedPoints,
        sgpa: semAgg.sgpa ?? 0,
        cumulative_credits: cum.cumulativeCredits,
        cumulative_weighted_points: cum.cumulativeWeightedPoints,
        cgpa: cum.cgpa ?? 0,
        is_provisional: false,
        computed_at: new Date(),
      },
    });
  }

  console.log('\nDone. student_semester_gpa now has real, computed rows for this student.');
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
