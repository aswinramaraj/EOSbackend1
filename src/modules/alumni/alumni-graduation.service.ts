import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from 'src/prisma/prisma.service';

/**
 * Graduates batches into the alumni system. A batch is "due" once its
 * end_year has fully elapsed (end_year < the current calendar year — a
 * batch ending this year is still mid-session, not yet graduated) and it
 * has no alumni_batches row yet.
 *
 * graduateBatch() is the single source of truth for the graduation logic —
 * both the daily cron and the manual admin "graduate now" endpoint call it,
 * so there is exactly one place that can create alumni_batches/alumni_members
 * rows or flip a student's users.role_id to 'alumni'.
 */
@Injectable()
export class AlumniGraduationService {
  private readonly logger = new Logger(AlumniGraduationService.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async runDailyGraduation() {
    const currentYear = new Date().getFullYear();

    const dueBatches = await this.prisma.batches.findMany({
      where: { end_year: { lt: currentYear }, alumni_batches: null },
      select: { id: true },
    });

    for (const batch of dueBatches) {
      try {
        await this.graduateBatch(batch.id);
      } catch (err) {
        this.logger.error(
          `Failed to graduate batch ${batch.id}`,
          err instanceof Error ? err.stack : String(err),
        );
      }
    }

    if (dueBatches.length > 0) {
      this.logger.log(
        `Graduation run processed ${dueBatches.length} batch(es)`,
      );
    }
  }

  /**
   * Graduates one batch: creates its alumni_batches row, one alumni_members
   * row per student in the batch, and flips each of those students'
   * users.role_id to the 'alumni' role (looked up by name, upserted if it
   * doesn't exist yet — never hardcoded).
   *
   * Idempotent: throws ConflictException if the batch is already graduated.
   * Checked once before opening the transaction (fast path) and again
   * inside it (closes the race between two concurrent callers, e.g. the
   * cron and a manual admin trigger firing at the same time).
   *
   * Wrapped in a single Prisma transaction — if any student in the loop
   * fails to graduate, Postgres rolls back the alumni_batches row and every
   * alumni_members/users update made so far for this batch, so a partial
   * failure never leaves the batch half-graduated.
   */
  async graduateBatch(batchId: number) {
    const batch = await this.prisma.batches.findUnique({
      where: { id: batchId },
    });
    if (!batch) {
      throw new NotFoundException({
        message: `Batch ${batchId} not found`,
        errorCode: 'BATCH_NOT_FOUND',
      });
    }

    const existing = await this.prisma.alumni_batches.findUnique({
      where: { batch_id: batchId },
    });
    if (existing) {
      throw new ConflictException({
        message: 'This batch has already been graduated',
        errorCode: 'BATCH_ALREADY_GRADUATED',
      });
    }

    return this.prisma.$transaction(async (tx) => {
      const raced = await tx.alumni_batches.findUnique({
        where: { batch_id: batchId },
      });
      if (raced) {
        throw new ConflictException({
          message: 'This batch has already been graduated',
          errorCode: 'BATCH_ALREADY_GRADUATED',
        });
      }

      const alumniRole = await tx.roles.upsert({
        where: { name: 'alumni' },
        update: {},
        create: { name: 'alumni', description: 'Alumni' },
      });

      // "<course code> <start>-<end> Alumni" when the batch has exactly one
      // course across its students; otherwise fall back to the batch name —
      // a batch (admission-year cohort) can span multiple departments/courses
      // (see the `classes` table), so a single course name isn't always safe.
      const distinctCourses = await tx.students.findMany({
        where: { batch_id: batchId },
        select: { course_id: true },
        distinct: ['course_id'],
      });

      let groupName = `${batch.name} Alumni`;
      if (distinctCourses.length === 1) {
        const course = await tx.courses.findUnique({
          where: { id: distinctCourses[0].course_id },
        });
        if (course) {
          groupName = `${course.code} ${batch.start_year}-${batch.end_year} Alumni`;
        }
      }

      const alumniBatch = await tx.alumni_batches.create({
        data: { batch_id: batchId, group_name: groupName },
      });

      const students = await tx.students.findMany({
        where: { batch_id: batchId },
        select: { id: true, user_id: true },
      });

      for (const student of students) {
        await tx.alumni_members.create({
          data: { alumni_batch_id: alumniBatch.id, student_id: student.id },
        });
        await tx.users.update({
          where: { id: student.user_id },
          data: { role_id: alumniRole.id },
        });
      }

      return {
        alumni_batch_id: alumniBatch.id,
        batch_id: batchId,
        group_name: alumniBatch.group_name,
        graduated_students: students.length,
      };
    });
  }
}
