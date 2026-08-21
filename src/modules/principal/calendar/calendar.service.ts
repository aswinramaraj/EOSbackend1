import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { AcademicCalendarEventsService } from 'src/modules/academic-structure/academic-calendar-events/academic-calendar-events.service';
import { CreateAcademicCalendarEventDto } from 'src/modules/academic-structure/academic-calendar-events/dto/create-academic-calendar-event.dto';
import { AddPrincipalEventDto } from './dto/add-event.dto';
import { AddPersonalEntryDto } from './dto/add-personal-entry.dto';

@Injectable()
export class PrincipalCalendarService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly academicCalendarEventsService: AcademicCalendarEventsService,
  ) {}

  /**
   * GET /me/principal/calendar/events?year=&month=
   *
   * Real calendar_events for that real calendar month, across every
   * academic_calendars row (institution-wide view — Principal has no
   * single batch/semester scope). Reuses the existing, already-open
   * AcademicCalendarEventsService.findAll() rather than a new query.
   */
  async eventsForMonth(year: number, month: number) {
    const monthStart = new Date(Date.UTC(year, month - 1, 1));
    const monthEnd = new Date(Date.UTC(year, month, 0));
    const events = await this.academicCalendarEventsService.findAll();
    return events.filter(
      (e) => e.event_date >= monthStart && e.event_date <= monthEnd,
    );
  }

  /**
   * POST /me/principal/calendar/events
   *
   * calendar_events.academic_calendar_id is mandatory (schema requires
   * every event to belong to one batch+semester's calendar) — the
   * Principal's simplified "Day + Event + Category" form has no calendar
   * picker, so this resolves the real academic_calendars row whose real
   * date range covers the chosen date. If none exists — a real, live gap:
   * this database has no academic_calendars row covering the current
   * month for any batch — this fails with a clear, honest error instead
   * of guessing which calendar to attach it to.
   *
   * start_time/end_time are mandatory on the underlying DTO (it also backs
   * timed academic events) — defaulted to a full working day (08:00–18:00)
   * since institution-wide entries like holidays/announcements aren't
   * naturally time-boxed, and this reuses the existing, already-validated
   * AcademicCalendarEventsService.create() rather than duplicating its
   * date-range/time-range checks.
   */
  async addEvent(input: AddPrincipalEventDto, userId: number) {
    const eventDate = new Date(`${input.event_date}T00:00:00.000Z`);

    const calendar = await this.prisma.academic_calendars.findFirst({
      where: { start_date: { lte: eventDate }, end_date: { gte: eventDate } },
      orderBy: { batch_id: 'asc' },
    });

    if (!calendar) {
      throw new UnprocessableEntityException({
        message: `No academic calendar covers ${input.event_date} yet — an Academic Coordinator needs to create one for this period before events can be added to it.`,
        errorCode: 'NO_ACADEMIC_CALENDAR_FOR_DATE',
      });
    }

    const dto: CreateAcademicCalendarEventDto = {
      academic_calendar_id: calendar.id,
      title: input.title,
      description: input.description,
      event_date: input.event_date,
      event_type: input.event_type,
      start_time: '08:00',
      end_time: '18:00',
    };

    return this.academicCalendarEventsService.create(dto, userId);
  }

  /**
   * GET /me/principal/calendar/personal-entries?year=&month=
   *
   * personal_calendar_entries is genuinely private to-do/reminder data —
   * unlike calendar_events (institution-wide, everyone reads the same
   * rows), this is filtered by user_id so a Principal only ever sees their
   * own entries, never another user's. No existing module in this codebase
   * touched this table before now.
   */
  async personalEntriesForMonth(userId: number, year: number, month: number) {
    const monthStart = new Date(Date.UTC(year, month - 1, 1));
    const monthEnd = new Date(Date.UTC(year, month, 0));
    return this.prisma.personal_calendar_entries.findMany({
      where: {
        user_id: userId,
        entry_date: { gte: monthStart, lte: monthEnd },
      },
      orderBy: { entry_date: 'asc' },
    });
  }

  /**
   * POST /me/principal/calendar/personal-entries
   *
   * Unlike calendar_events, this table has no academic_calendar_id (or any
   * other FK to a batch/semester) — it's just user_id + a date, so it
   * works for any date immediately, including "today", with no dependency
   * on an academic_calendars row existing for the period.
   */
  addPersonalEntry(input: AddPersonalEntryDto, userId: number) {
    return this.prisma.personal_calendar_entries.create({
      data: {
        user_id: userId,
        entry_date: new Date(`${input.entry_date}T00:00:00.000Z`),
        title: input.title,
        details: input.details,
        category: input.category,
      },
    });
  }

  /** DELETE /me/principal/calendar/personal-entries/:id — only the owner may delete their own entry. */
  async removePersonalEntry(id: number, userId: number) {
    const entry = await this.prisma.personal_calendar_entries.findUnique({
      where: { id },
    });
    if (!entry) {
      throw new NotFoundException({
        message: 'Personal calendar entry not found',
        errorCode: 'NOT_FOUND',
      });
    }
    if (entry.user_id !== userId) {
      throw new ForbiddenException({
        message: 'You may only delete your own calendar entries',
        errorCode: 'NOT_OWNER',
      });
    }
    await this.prisma.personal_calendar_entries.delete({ where: { id } });
    return { message: 'Personal calendar entry deleted successfully' };
  }
}
