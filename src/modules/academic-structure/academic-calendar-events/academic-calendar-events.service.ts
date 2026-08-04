import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateAcademicCalendarEventDto } from './dto/create-academic-calendar-event.dto';
import { UpdateAcademicCalendarEventDto } from './dto/update-academic-calendar-event.dto';

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
      return await this.prisma.calendar_events.create({
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
    } catch (err) {
      this.logger.error('DB error creating academic calendar event', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  findAll(academicCalendarId?: number) {
    return this.prisma.calendar_events.findMany({
      where: academicCalendarId
        ? { academic_calendar_id: academicCalendarId }
        : undefined,
      orderBy: { event_date: 'asc' },
    });
  }

  async findOne(id: number) {
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

  async update(id: number, dto: UpdateAcademicCalendarEventDto) {
    const event = await this.findOne(id);

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
      return await this.prisma.calendar_events.update({
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

  async remove(id: number) {
    await this.findOne(id);
    await this.prisma.calendar_events.delete({ where: { id } });
    return { message: 'Academic calendar event deleted successfully' };
  }
}
