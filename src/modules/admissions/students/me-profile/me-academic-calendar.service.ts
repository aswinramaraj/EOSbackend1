import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';

function toDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

@Injectable()
export class MeAcademicCalendarService {
  private readonly logger = new Logger(MeAcademicCalendarService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * GET /me/academic-calendar
   *
   * Self-scoped: class_id resolved from the JWT's linked student record,
   * then class_id -> classes.batch_id/current_semester -> the matching
   * academic_calendars row (unique on batch_id+semester) -> its
   * calendar_events. There is no student-facing filter for any of this
   * anywhere else in the schema - GET /academic-calendar and
   * GET /academic-calendar-events are open reads with no batch/semester
   * scoping of their own, so a student calling those directly would have to
   * already know their own raw batch_id, which nothing exposes to them.
   *
   * A student with no class assigned, or whose batch/semester has no
   * academic_calendars row yet (not created by the Academic Coordinator),
   * gets an honest empty response, not an error - there's nothing to show.
   *
   * `event_type` is only ever "holiday" or "event" (calendar_event_type_enum)
   * - there is no "review"/"exam" category anywhere in the schema.
   *
   * Error cases:
   *  404 STUDENT_NOT_FOUND – authenticated user has no linked student record
   *  500 INTERNAL_ERROR    – unexpected DB failure
   */
  async getMyAcademicCalendar(userId: number) {
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

    return this.computeCalendarForClass(userId, student.class_id);
  }

  /**
   * Same computation as getMyAcademicCalendar, but for a student chosen by
   * id rather than resolved from the caller's own JWT - used by
   * ParentsService once it has verified (via parent_student_mapping) that
   * the caller is actually this student's parent.
   */
  async getAcademicCalendarForStudentId(studentId: number) {
    const student = await this.prisma.students.findUnique({
      where: { id: studentId },
      select: { class_id: true },
    });

    if (!student) {
      throw new NotFoundException('Student not found');
    }

    return this.computeCalendarForClass(studentId, student.class_id);
  }

  private async computeCalendarForClass(
    idForLogging: number,
    classId: number | null,
  ) {
    if (classId === null) {
      return { semester: null, start_date: null, end_date: null, events: [] };
    }

    const klass = await this.fetchClass(idForLogging, classId);
    if (!klass || klass.current_semester === null) {
      return { semester: null, start_date: null, end_date: null, events: [] };
    }

    const calendar = await this.fetchCalendar(
      idForLogging,
      klass.batch_id,
      klass.current_semester,
    );

    if (!calendar) {
      return {
        semester: klass.current_semester,
        start_date: null,
        end_date: null,
        events: [],
      };
    }

    return {
      semester: klass.current_semester,
      start_date: toDateOnly(calendar.start_date),
      end_date: toDateOnly(calendar.end_date),
      events: calendar.calendar_events.map((event) => ({
        id: event.id,
        event_date: toDateOnly(event.event_date),
        event_type: event.event_type,
        title: event.title,
        description: event.description,
      })),
    };
  }

  private async fetchClass(userId: number, classId: number) {
    try {
      return await this.prisma.classes.findUnique({
        where: { id: classId },
        select: { batch_id: true, current_semester: true },
      });
    } catch (err) {
      this.logger.error(`Failed to fetch class for user ${userId}`, err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  private async fetchCalendar(
    userId: number,
    batchId: number,
    semester: number,
  ) {
    try {
      return await this.prisma.academic_calendars.findUnique({
        where: { batch_id_semester: { batch_id: batchId, semester } },
        select: {
          start_date: true,
          end_date: true,
          calendar_events: {
            select: {
              id: true,
              event_date: true,
              event_type: true,
              title: true,
              description: true,
            },
            orderBy: { event_date: 'asc' },
          },
        },
      });
    } catch (err) {
      this.logger.error(
        `Failed to fetch academic calendar for user ${userId}`,
        err,
      );
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }
}
