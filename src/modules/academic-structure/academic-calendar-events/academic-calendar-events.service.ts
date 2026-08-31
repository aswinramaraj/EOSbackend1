import {
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { ROLES } from 'src/common/constants/roles.constant';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { CreateAcademicCalendarEventDto } from './dto/create-academic-calendar-event.dto';
import { UpdateAcademicCalendarEventDto } from './dto/update-academic-calendar-event.dto';

/**
 * Roles that may publish their own events onto the shared academic calendar
 * but must not be able to edit or delete anyone else's. The calendar also
 * carries institution-wide entries (semester boundaries, exam dates, holidays),
 * so blanket write access here would let a departmental role remove them.
 */
const OWN_EVENTS_ONLY_ROLES: readonly string[] = [
  ROLES.MEDIA_ROOM,
  ROLES.PLACEMENT,
];

@Injectable()
export class AcademicCalendarEventsService {
  private readonly logger = new Logger(AcademicCalendarEventsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Prisma's DateTime scalar (even for an @db.Date column) requires a full
   * ISO-8601 string or a Date instance — a bare "YYYY-MM-DD" throws
   * "premature end of input. Expected ISO-8601 DateTime." Postgres keeps
   * only the date part; the time-of-day here is arbitrary and discarded.
   */
  private toDateOnly(value: string): Date {
    return new Date(`${value}T00:00:00.000Z`);
  }

  /**
   * Same ISO-8601 requirement applies to @db.Time(6) columns. Postgres keeps
   * only the time-of-day; 1970-01-01 is an arbitrary reference date.
   */
  private toTimeOnly(value: string): Date {
    const [hours, minutes, seconds = '00'] = value.split(':');
    return new Date(
      `1970-01-01T${hours.padStart(2, '0')}:${minutes.padStart(2, '0')}:${seconds.padStart(2, '0')}.000Z`,
    );
  }

  /**
   * The typed Prisma client hands back @db.Time(6) columns as Date objects
   * anchored at 1970-01-01 — left as-is, NestJS's default JSON serializer
   * renders the full ISO string ("1970-01-01T09:00:00.000Z"), and every
   * caller expecting a plain "HH:MM" (e.g. `start_time.slice(0, 5)`) reads
   * back "1970-" instead of the actual time. Formatted to "HH:MM" here so
   * every response carries what callers actually expect.
   */
  private toTimeString(value: Date | null): string | null {
    if (!value) return null;
    return value.toISOString().slice(11, 16);
  }

  private serializeEvent<
    T extends { event_date: Date; start_time: Date | null; end_time: Date | null },
  >(
    event: T,
  ): Omit<T, 'event_date' | 'start_time' | 'end_time'> & {
    event_date: string;
    start_time: string | null;
    end_time: string | null;
  } {
    return {
      ...event,
      // Same Date-vs-string mismatch as start_time/end_time — left as a
      // Date, this serializes to a full ISO string ("2026-08-20T00:00:00.000Z")
      // instead of the plain "YYYY-MM-DD" every other academic-calendar
      // endpoint in this app returns (see HodAcademicCalendarService).
      event_date: event.event_date.toISOString().slice(0, 10),
      start_time: this.toTimeString(event.start_time),
      end_time: this.toTimeString(event.end_time),
    };
  }

  private assertDateWithinCalendar(
    eventDate: Date,
    calendar: { start_date: Date; end_date: Date },
  ) {
    if (eventDate < calendar.start_date || eventDate > calendar.end_date) {
      throw new UnprocessableEntityException({
        message: 'Event date must be within the academic calendar date range',
        errorCode: 'INVALID_EVENT_DATE',
      });
    }
  }

  private assertTimeRange(startTime: Date, endTime: Date) {
    if (endTime.getTime() <= startTime.getTime()) {
      throw new UnprocessableEntityException({
        message: 'end_time must be after start_time',
        errorCode: 'INVALID_EVENT_TIME_RANGE',
      });
    }
  }

  /**
   * Departmental roles may only mutate the events they themselves created.
   * The privileged calendar owners (coordinator/principal/secretary) keep
   * unrestricted access, so this narrows the two newly-granted roles only.
   */
  private assertMayMutate(
    event: { created_by_user_id: number | null },
    currentUser?: JwtPayload,
  ): void {
    if (!currentUser || !OWN_EVENTS_ONLY_ROLES.includes(currentUser.role)) {
      return;
    }
    if (event.created_by_user_id !== currentUser.sub) {
      throw new ForbiddenException({
        message: 'You can only modify calendar events you created',
        errorCode: 'FORBIDDEN',
      });
    }
  }

  async create(dto: CreateAcademicCalendarEventDto, userId: number) {
    const calendar = await this.prisma.academic_calendars.findUnique({
      where: { id: dto.academic_calendar_id },
    });
    if (!calendar) {
      throw new NotFoundException({
        message: 'Academic calendar not found',
        errorCode: 'NOT_FOUND',
      });
    }

    const eventDate = this.toDateOnly(dto.event_date);
    const startTime = this.toTimeOnly(dto.start_time);
    const endTime = this.toTimeOnly(dto.end_time);

    this.assertDateWithinCalendar(eventDate, calendar);
    this.assertTimeRange(startTime, endTime);

    try {
      const created = await this.prisma.calendar_events.create({
        data: {
          academic_calendar_id: dto.academic_calendar_id,
          title: dto.title,
          description: dto.description,
          event_date: eventDate,
          event_type: dto.event_type,
          start_time: startTime,
          end_time: endTime,
          created_by_user_id: userId,
        },
      });
      return this.serializeEvent(created);
    } catch (err) {
      this.logger.error('DB error creating academic calendar event', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  async findAll(academicCalendarId?: number) {
    const events = await this.prisma.calendar_events.findMany({
      where: academicCalendarId
        ? { academic_calendar_id: academicCalendarId }
        : undefined,
      orderBy: { event_date: 'asc' },
    });
    return events.map((e) => this.serializeEvent(e));
  }

  /** Internal — returns the raw row (Date-typed times) for callers that need to compare/reuse them, e.g. `update()`. */
  private async findOneRaw(id: number) {
    const event = await this.prisma.calendar_events.findUnique({
      where: { id },
    });
    if (!event) {
      throw new NotFoundException({
        message: 'Academic calendar event not found',
        errorCode: 'NOT_FOUND',
      });
    }
    return event;
  }

  async findOne(id: number) {
    return this.serializeEvent(await this.findOneRaw(id));
  }

  async update(
    id: number,
    dto: UpdateAcademicCalendarEventDto,
    currentUser?: JwtPayload,
  ) {
    const event = await this.findOneRaw(id);
    this.assertMayMutate(event, currentUser);

    let finalCalendar: { start_date: Date; end_date: Date };

    if (
      dto.academic_calendar_id !== undefined &&
      dto.academic_calendar_id !== event.academic_calendar_id
    ) {
      const calendar = await this.prisma.academic_calendars.findUnique({
        where: { id: dto.academic_calendar_id },
      });
      if (!calendar) {
        throw new NotFoundException({
          message: 'Academic calendar not found',
          errorCode: 'NOT_FOUND',
        });
      }
      finalCalendar = calendar;
    } else {
      const calendar = await this.prisma.academic_calendars.findUnique({
        where: { id: event.academic_calendar_id },
      });
      if (!calendar) {
        throw new NotFoundException({
          message: 'Academic calendar not found',
          errorCode: 'NOT_FOUND',
        });
      }
      finalCalendar = calendar;
    }

    const eventDate =
      dto.event_date !== undefined
        ? this.toDateOnly(dto.event_date)
        : event.event_date;
    this.assertDateWithinCalendar(eventDate, finalCalendar);

    const startTime =
      dto.start_time !== undefined
        ? this.toTimeOnly(dto.start_time)
        : event.start_time;
    const endTime =
      dto.end_time !== undefined
        ? this.toTimeOnly(dto.end_time)
        : event.end_time;
    if (startTime && endTime) {
      this.assertTimeRange(startTime, endTime);
    }

    try {
      const updated = await this.prisma.calendar_events.update({
        where: { id },
        data: {
          academic_calendar_id: dto.academic_calendar_id,
          title: dto.title,
          description: dto.description,
          event_date: dto.event_date !== undefined ? eventDate : undefined,
          event_type: dto.event_type,
          start_time: dto.start_time !== undefined ? startTime : undefined,
          end_time: dto.end_time !== undefined ? endTime : undefined,
        },
      });
      return this.serializeEvent(updated);
    } catch (err) {
      this.logger.error(
        `DB error updating academic calendar event #${id}`,
        err,
      );
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  async remove(id: number, currentUser?: JwtPayload) {
    const event = await this.findOneRaw(id);
    this.assertMayMutate(event, currentUser);
    await this.prisma.calendar_events.delete({ where: { id } });
    return { message: 'Academic calendar event deleted successfully' };
  }
}
