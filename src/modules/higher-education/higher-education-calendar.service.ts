import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { Prisma } from '../../../generated/prisma/client';
import { TimetableService } from 'src/modules/faculty/timetable/timetable.service';
import { detectHigherEducationSchema } from './higher-education-schema.util';
import type { CreateCalendarEventDto } from './dto/create-calendar-event.dto';

interface HigherEdEventRow {
  id: number;
  title: string;
  event_date: Date;
  category: string | null;
}

/**
 * Academic calendar for the Higher Education Cell — merges the real,
 * shared institution-wide calendar (every batch's calendar_events, via
 * TimetableService.getInstitutionAcademicCalendar, same data HoD/HR Payroll/
 * Principal see) with higher_education_calendar_events, a new table for
 * events the cell adds itself (it has no batch/semester calendar of its
 * own to attach events to).
 */
@Injectable()
export class HigherEducationCalendarService {
  private readonly logger = new Logger(HigherEducationCalendarService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly timetableService: TimetableService,
  ) {}

  async getCalendar() {
    try {
      const institution = await this.timetableService.getInstitutionAcademicCalendar();

      const schema = await detectHigherEducationSchema(this.prisma);
      const ownRows = schema.calendarEvents
        ? await this.prisma.$queryRaw<HigherEdEventRow[]>(Prisma.sql`
            SELECT id, title, event_date, category FROM higher_education_calendar_events ORDER BY event_date ASC
          `)
        : [];

      const ownEvents = ownRows.map((r) => ({
        id: `he-${r.id}`,
        event_date: r.event_date.toISOString().slice(0, 10),
        event_type: r.category ?? 'institution',
        title: r.title,
        description: null as string | null,
      }));

      const merged = [...institution.events, ...ownEvents].sort((a, b) => a.event_date.localeCompare(b.event_date));

      return { ...institution, events: merged };
    } catch (err) {
      this.logger.error('DB error building higher-education academic calendar', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  async createEvent(dto: CreateCalendarEventDto) {
    try {
      const rows = await this.prisma.$queryRaw<{ id: number }[]>(Prisma.sql`
        INSERT INTO higher_education_calendar_events (title, event_date, category)
        VALUES (${dto.title}, ${dto.event_date}, ${dto.category ?? null})
        RETURNING id
      `);
      return { id: rows[0].id };
    } catch (err) {
      this.logger.error('DB error creating higher-education calendar event', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }
}
