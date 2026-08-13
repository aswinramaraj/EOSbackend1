import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';

/**
 * calendar_events has no department column and no direct department
 * relation — a row is only reachable via its parent academic_calendars row,
 * which is scoped to a single batch_id + semester (see prisma/schema.prisma
 * academic_calendars/calendar_events). There is no existing "events for
 * department X in month Y" query anywhere in the codebase (confirmed by
 * research before writing this), so this resolves it fresh: department's
 * classes -> their batch_ids -> academic_calendars rows whose date range
 * overlaps the requested month -> calendar_events in that month.
 *
 * calendar_event_type_enum currently only has 'holiday' | 'event' — the
 * design reference shows richer categories (Instruction/Assessment/
 * Placement/Institution) that don't exist in the schema yet. This service
 * returns whatever `event_type` string the database actually has; the
 * frontend renders it generically (capitalized, single blue chip style —
 * confirmed from the reference: every category renders with the exact same
 * chip style, no per-category color). Once/if the enum gains more values
 * via the ALTER TYPE statement handed to the user separately, this code
 * needs no changes at all.
 */
@Injectable()
export class HodAcademicCalendarService {
  constructor(private readonly prisma: PrismaService) {}

  private async resolveHodDepartment(userId: number) {
    const faculty = await this.prisma.faculty.findUnique({
      where: { user_id: userId },
      select: { department_id: true },
    });
    if (!faculty) {
      throw new NotFoundException(
        'Faculty profile not found for the authenticated user',
      );
    }
    return faculty;
  }

  /** GET /hod/academic-calendar?year=2026&month=8 */
  async getMonth(userId: number, year: number, month: number) {
    const { department_id } = await this.resolveHodDepartment(userId);

    const classes = await this.prisma.classes.findMany({
      where: { department_id },
      select: { batch_id: true },
    });
    const batchIds = [...new Set(classes.map((c) => c.batch_id))];

    const monthStart = new Date(Date.UTC(year, month - 1, 1));
    const monthEnd = new Date(Date.UTC(year, month, 0));

    const calendars = batchIds.length
      ? await this.prisma.academic_calendars.findMany({
          where: {
            batch_id: { in: batchIds },
            start_date: { lte: monthEnd },
            end_date: { gte: monthStart },
          },
          select: { id: true },
        })
      : [];
    const calendarIds = calendars.map((c) => c.id);

    const events = calendarIds.length
      ? await this.prisma.calendar_events.findMany({
          where: {
            academic_calendar_id: { in: calendarIds },
            event_date: { gte: monthStart, lte: monthEnd },
          },
          orderBy: { event_date: 'asc' },
          select: {
            id: true,
            event_date: true,
            title: true,
            description: true,
            event_type: true,
          },
        })
      : [];

    return {
      year,
      month,
      events: events.map((e) => ({
        id: e.id,
        event_date: e.event_date.toISOString().slice(0, 10),
        title: e.title,
        description: e.description,
        event_type: e.event_type,
      })),
    };
  }
}
