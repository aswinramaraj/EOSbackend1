/**
 * One-time backfill: computes and stores SGPA/CGPA (`student_semester_gpa`)
 * for every student who has at least one exam_marks row, but no stored GPA
 * yet — everyone whose results were published before GpaRecomputeService
 * existed. Going forward, ResultsService.publish() and an approved
 * RevaluationService.update() keep this table current automatically; this
 * script exists only to catch up everyone who predates that wiring.
 *
 * Idempotent and safe to re-run: GpaRecomputeService.recomputeAllForStudent()
 * upserts on (student_id, semester), so running this twice just recomputes
 * the same correct values again rather than duplicating rows.
 *
 * Run with: npx ts-node -r tsconfig-paths/register scripts/backfill-student-semester-gpa.ts
 * (or: node -r @swc-node/register scripts/backfill-student-semester-gpa.ts)
 *
 * Prints a per-student summary and a final count so you can compare against
 * `SELECT count(DISTINCT student_id) FROM exam_marks` afterward.
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';
import { GpaRecomputeService } from '../src/modules/exams/gpa/gpa-recompute.service';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter } as any);

async function main() {
  const students: { student_id: number }[] = await prisma.$queryRawUnsafe(`
    SELECT DISTINCT student_id FROM exam_marks ORDER BY student_id
  `);

  console.log(`Found ${students.length} students with at least one exam_marks row.`);

  const service = new (GpaRecomputeService as any)(prisma) as GpaRecomputeService;

  let succeeded = 0;
  let failed = 0;

  for (const { student_id } of students) {
    try {
      await service.recomputeAllForStudent(student_id);
      succeeded++;
    } catch (err) {
      failed++;
      console.error(`Failed to backfill student ${student_id}:`, err);
    }
    if ((succeeded + failed) % 50 === 0) {
      console.log(`... ${succeeded + failed}/${students.length} processed`);
    }
  }

  const finalCount: { n: number }[] = await prisma.$queryRawUnsafe(`
    SELECT count(*)::int AS n FROM student_semester_gpa
  `);

  console.log('---');
  console.log(`Done. Succeeded: ${succeeded}, Failed: ${failed}.`);
  console.log(`student_semester_gpa now has ${finalCount[0]?.n} rows total.`);
}

main().finally(() => prisma.$disconnect());
