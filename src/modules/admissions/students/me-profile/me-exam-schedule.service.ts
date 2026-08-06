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
      select: { class_id: true },
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

    const rows = await this.fetchSchedule(userId, student.class_id);

    return rows.map((row) => ({
      id: row.id,
      exam_type: row.exam_subject_mapping.exams.exam_types.name,
      academic_year: row.exam_subject_mapping.exams.academic_year,
      semester: row.exam_subject_mapping.exams.semester,
      subject_name: row.exam_subject_mapping.subjects.name,
      subject_code: row.exam_subject_mapping.subjects.subject_code,
      exam_date: toDateOnly(row.exam_date),
      start_time: toTimeOnly(row.start_time),
      end_time: toTimeOnly(row.end_time),
    }));
  }

  private async fetchSchedule(userId: number, classId: number) {
    try {
      return await this.prisma.exam_timetable.findMany({
        where: {
          exam_timetable_versions: { status: 'published' },
          exam_subject_mapping: { class_id: classId },
        },
        select: {
          id: true,
          exam_date: true,
          start_time: true,
          end_time: true,
          exam_subject_mapping: {
            select: {
              subjects: { select: { name: true, subject_code: true } },
              exams: {
                select: {
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
}
