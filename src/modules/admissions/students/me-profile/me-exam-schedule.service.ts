import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';

function toTimeOnly(date: Date): string {
  return date.toISOString().slice(11, 16);
}

function toDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

@Injectable()
export class MeExamScheduleService {
  private readonly logger = new Logger(MeExamScheduleService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * GET /me/exam-schedule
   *
   * Self-scoped: student_id/class_id resolved from the JWT. Returns every
   * *published* exam_timetable row for the caller's own class - unpublished
   * rows and other classes' schedules are never returned. Composes across
   * exam_timetable -> exam_subject_mapping -> exams/exam_types/subjects,
   * none of which expose these display names on their own public list
   * endpoints (those return raw FK ids only).
   *
   * A student with no class_id assigned yet gets an empty list, not an
   * error - there's nothing to schedule against.
   *
   * Error cases:
   *  404 STUDENT_NOT_FOUND – the authenticated user has no linked student record
   *  500 INTERNAL_ERROR    – unexpected DB failure
   */
  async getMyExamSchedule(userId: number) {
    const student = await this.prisma.students.findUnique({
      where: { user_id: userId },
      select: { id: true, class_id: true },
    });

    if (!student) {
      throw new NotFoundException({
        message: 'Student profile not found for this account',
        errorCode: 'STUDENT_NOT_FOUND',
      });
    }

    if (student.class_id === null) {
      return [];
    }

    const [rows, seatingByKey] = await Promise.all([
      this.fetchSchedule(userId, student.class_id),
      this.fetchSeatingByExamDate(userId, student.id),
    ]);

    return rows.map((row) => {
      // Keyed by exam_id *and* exam_date, not exam_id alone — a single exam
      // (e.g. "Semester 1 Quiz") schedules one exam_subject_mapping/date per
      // subject under the same exam_id, so an exam_id-only key would collide
      // and silently show every subject the same, last-written seat.
      const seating = seatingByKey.get(
        `${row.exam_subject_mapping.exams.id}:${toDateOnly(row.exam_date)}`,
      );
      return {
        id: row.id,
        exam_type: row.exam_subject_mapping.exams.exam_types.name,
        academic_year: row.exam_subject_mapping.exams.academic_year,
        semester: row.exam_subject_mapping.exams.semester,
        subject_name: row.exam_subject_mapping.subjects.name,
        subject_code: row.exam_subject_mapping.subjects.subject_code,
        exam_date: toDateOnly(row.exam_date),
        start_time: toTimeOnly(row.start_time),
        end_time: toTimeOnly(row.end_time),
        session: row.session,
        // hall_plans (via the student's own seating_arrangements row) is the
        // real source of the assigned venue, same as HallTicketsService.getSchedule() —
        // exam_timetable.venue_id is a separate, effectively-unused column
        // that's never populated by the actual seat-allocation workflow, so
        // it's kept only as a fallback for a row that happens to have it set.
        venue_name: seating?.venue_name ?? row.venues?.name ?? null,
        seat_number: seating?.seat_number ?? null,
      };
    });
  }

  private async fetchSchedule(userId: number, classId: number) {
    try {
      return await this.prisma.exam_timetable.findMany({
        where: {
          exam_subject_mapping: {
            class_id: classId,
            is_published: true,
          },
        },
        select: {
          id: true,
          exam_date: true,
          start_time: true,
          end_time: true,
          session: true,
          venues: { select: { name: true } },
          exam_subject_mapping: {
            select: {
              subjects: { select: { name: true, subject_code: true } },
              exams: {
                select: {
                  id: true,
                  academic_year: true,
                  semester: true,
                  exam_types: { select: { name: true } },
                },
              },
            },
          },
        },
        orderBy: [{ exam_date: 'asc' }, { start_time: 'asc' }],
      });
    } catch (err) {
      this.logger.error(
        `Failed to fetch exam schedule for user ${userId}`,
        err,
      );
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * Real per-student seat + venue, keyed by "exam_id:exam_date" — same
   * seating_arrangements -> hall_plans -> venues join and per-date keying
   * HallTicketsService.getSchedule() already uses for the COE-facing hall-ticket
   * preview (that one scopes to a single exam_id so a bare date key is enough;
   * this endpoint spans every exam the student has, so the key includes
   * exam_id too). Most exams have no hall_plans row yet (seat allocation is a
   * separate, later step from timetable publishing), so this is a best-effort
   * map, not a join that would drop schedule rows with no seat assigned.
   */
  private async fetchSeatingByExamDate(
    userId: number,
    studentId: number,
  ): Promise<Map<string, { seat_number: string; venue_name: string | null }>> {
    try {
      const seating = await this.prisma.seating_arrangements.findMany({
        where: { student_id: studentId },
        select: {
          seat_number: true,
          hall_plans: {
            select: {
              exam_id: true,
              exam_date: true,
              venues: { select: { name: true } },
            },
          },
        },
      });
      return new Map(
        seating.map((s) => [
          `${s.hall_plans.exam_id}:${toDateOnly(s.hall_plans.exam_date)}`,
          {
            seat_number: s.seat_number,
            venue_name: s.hall_plans.venues?.name ?? null,
          },
        ]),
      );
    } catch (err) {
      this.logger.error(`Failed to fetch exam seating for user ${userId}`, err);
      return new Map();
    }
  }
}
