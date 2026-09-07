/**
 * Class 1128 (CS-UG-D, 2024-2028) has real, fully-graded exam_marks for
 * semesters 1, 3 and 5 (all 66 students) — but semesters 2 and 4 only ever
 * had marks for one student (malar.sekar2024cse@sece.ac.in, student_id
 * 22609), left over from earlier session work. The Faculty/HoD
 * "Examination & Results" semester filter surfaces this directly: picking
 * Semester 2 or 4 would show 65 blank rows next to Malar's one real row.
 *
 * This backfills exam_marks for the other 65 students, for every
 * (semester, exam_type, subject) combination that already exists for
 * semester 2/4 (24 exam_subject_mapping rows each — CIA1/CIA2/Quiz/
 * University End Semester Exam × 6 subjects; CIA3 is a genuine, already-
 * decided gap for even semesters, left untouched).
 *
 * max_marks is read from Malar's own existing row for each mapping (not
 * invented) — so every student's max_marks for a given paper matches hers
 * exactly. entered_by_faculty_id/is_moderated/verified_at are left null,
 * matching her own rows' pattern exactly (faculty_subject_class_mapping
 * only tracks *current*-semester assignments, so there's no real faculty
 * link available for a semester-2/4 subject to attribute this to instead
 * of inventing one).
 *
 * marks_obtained is generated to match the real distribution already
 * measured from semesters 1/3/5 for this same class (~65-70% of max_marks
 * on average, wide spread, ~2.5-4% absence rate) — not uniform random
 * noise, and not a flat curve.
 *
 * Idempotent — every insert is preceded by an existence check via the
 * table's own (exam_subject_mapping_id, student_id) unique constraint.
 * Run from EOSbackend1: node -r @swc-node/register scripts/seed-class1128-sem2-sem4-marks.ts
 */
import 'dotenv/config';
import { Pool } from 'pg';

const CLASS_ID = 1128;
const SEMESTERS = [2, 4];
const ABSENT_RATE = 0.03;

// Sum of 3 uniform randoms approximates a normal distribution (CLT) —
// good enough for plausible-looking spread without a real stats library.
function approxNormal(): number {
  return (Math.random() + Math.random() + Math.random()) / 3;
}

// Centers around ~66% of max_marks with real-world-like spread, rounded to
// the nearest 0.5 (matching the half-mark granularity seen in real rows),
// clipped to [0, max_marks].
function generateMarks(maxMarks: number): number {
  const centered = 0.66 + (approxNormal() - 0.5) * 0.7;
  const raw = Math.min(1, Math.max(0, centered)) * maxMarks;
  return Math.round(raw * 2) / 2;
}

async function main() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 1,
    idleTimeoutMillis: 0,
    connectionTimeoutMillis: 20000,
  });
  const client = await pool.connect();
  try {
    console.log('Connected.\n');

    const students = await client.query<{ id: number }>(
      `SELECT id FROM students WHERE class_id = $1 AND status = 'active' ORDER BY id`,
      [CLASS_ID],
    );
    console.log(
      `${students.rows.length} active students in class ${CLASS_ID}.\n`,
    );

    let totalInserted = 0;
    let totalSkippedExisting = 0;

    for (const semester of SEMESTERS) {
      const mappings = await client.query<{
        mapping_id: number;
        subject_name: string;
        exam_type: string;
      }>(
        `
        SELECT esm.id AS mapping_id, s.name AS subject_name, et.name AS exam_type
        FROM exam_subject_mapping esm
        JOIN exams ex ON ex.id = esm.exam_id
        JOIN exam_types et ON et.id = ex.exam_type_id
        JOIN subjects s ON s.id = esm.subject_id
        WHERE esm.class_id = $1 AND ex.semester = $2
        ORDER BY et.name, s.name
        `,
        [CLASS_ID, semester],
      );
      console.log(`Semester ${semester}: ${mappings.rows.length} mappings.`);

      for (const mapping of mappings.rows) {
        // Existing rows for this mapping (Malar's real one, plus any
        // already backfilled by a prior partial run).
        const existing = await client.query<{
          student_id: number;
          max_marks: string;
        }>(
          `SELECT student_id, max_marks FROM exam_marks WHERE exam_subject_mapping_id = $1`,
          [mapping.mapping_id],
        );
        if (existing.rows.length === 0) {
          console.warn(
            `  No existing exam_marks row for mapping ${mapping.mapping_id} (${mapping.exam_type} ${mapping.subject_name}) — skipping, no max_marks to source.`,
          );
          continue;
        }
        const maxMarks = Number(existing.rows[0].max_marks);
        const existingStudentIds = new Set(
          existing.rows.map((r) => r.student_id),
        );

        for (const student of students.rows) {
          if (existingStudentIds.has(student.id)) {
            totalSkippedExisting++;
            continue;
          }
          const isAbsent = Math.random() < ABSENT_RATE;
          const marksObtained = isAbsent ? null : generateMarks(maxMarks);
          await client.query(
            `INSERT INTO exam_marks (exam_subject_mapping_id, student_id, marks_obtained, max_marks, is_absent)
             VALUES ($1, $2, $3, $4, $5)`,
            [mapping.mapping_id, student.id, marksObtained, maxMarks, isAbsent],
          );
          totalInserted++;
        }
      }
    }

    console.log(
      `\nDone. Inserted ${totalInserted} exam_marks rows, skipped ${totalSkippedExisting} already-existing.`,
    );

    // Sanity check — should now match the fully-real semesters' coverage.
    const coverage = await client.query(
      `
      SELECT ex.semester, et.name AS exam_type, COUNT(DISTINCT em.student_id) AS students_with_marks
      FROM exams ex
      JOIN exam_types et ON et.id = ex.exam_type_id
      JOIN exam_subject_mapping esm ON esm.exam_id = ex.id AND esm.class_id = $1
      LEFT JOIN exam_marks em ON em.exam_subject_mapping_id = esm.id
      WHERE ex.semester = ANY($2::int[])
      GROUP BY ex.semester, et.name
      ORDER BY ex.semester, et.name
      `,
      [CLASS_ID, SEMESTERS],
    );
    console.log('\nCoverage after seeding:', coverage.rows);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('\nFAILED:', err);
  process.exit(1);
});
