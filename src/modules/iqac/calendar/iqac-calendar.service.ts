import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { calendar_event_type_enum } from 'generated/prisma/enums';

function startOfToday(): Date {
  return new Date(new Date().toISOString().slice(0, 10));
}

/** Jul–Dec or Jan–Jun of the current calendar year — same "current term" window every other quality-domain page uses. */
function currentTermRange(today: Date): { start: Date; end: Date } {
  const calendarYear = today.getUTCFullYear();
  const month = today.getUTCMonth() + 1;
  if (month >= 7) {
    return {
      start: new Date(Date.UTC(calendarYear, 6, 1)),
      end: new Date(Date.UTC(calendarYear, 11, 31)),
    };
  }
  return {
    start: new Date(Date.UTC(calendarYear, 0, 1)),
    end: new Date(Date.UTC(calendarYear, 5, 30)),
  };
}

function priorYearTermRange(range: { start: Date; end: Date }): {
  start: Date;
  end: Date;
} {
  return {
    start: new Date(
      Date.UTC(
        range.start.getUTCFullYear() - 1,
        range.start.getUTCMonth(),
        range.start.getUTCDate(),
      ),
    ),
    end: new Date(
      Date.UTC(
        range.end.getUTCFullYear() - 1,
        range.end.getUTCMonth(),
        range.end.getUTCDate(),
      ),
    ),
  };
}

function inRange(date: Date, range: { start: Date; end: Date }): boolean {
  return date >= range.start && date <= range.end;
}

function currentAcademicYearLabel(today: Date): string {
  const calendarYear = today.getUTCFullYear();
  const month = today.getUTCMonth() + 1;
  const start = month >= 6 ? calendarYear : calendarYear - 1;
  return `${start}-${start + 1}`;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * IQAC's own read of the real academic calendar — same underlying
 * calendar_events/academic_calendars tables the shared
 * AcademicCalendarEventsService (academic-structure module) already
 * exposes read-only to every role, but joined here to the real batch/
 * semester each event's academic_calendars row carries, which that shared
 * endpoint doesn't return. IQAC has no write access here (creating/editing
 * calendar events stays Academic Coordinator/Principal/Secretary's job,
 * same as before) — this module is read-only.
 */
@Injectable()
export class IqacCalendarService {
  constructor(private readonly prisma: PrismaService) {}

  private async targetFor(metricKey: string): Promise<number | null> {
    const row = await this.prisma.iqac_metric_targets.findUnique({
      where: {
        metric_key_academic_year: {
          metric_key: metricKey,
          academic_year: currentAcademicYearLabel(startOfToday()),
        },
      },
    });
    return row ? Number(row.target_value) : null;
  }

  /** GET /me/iqac/calendar/filters — real batch list, for the page's Batch select. */
  async filters() {
    const batches = await this.prisma.batches.findMany({
      select: { id: true, name: true },
      orderBy: { start_year: 'desc' },
    });
    return { batches };
  }

  /**
   * GET /me/iqac/calendar/events?batch_id=&semester=&type=
   * Every real calendar_events row, enriched with the real batch/semester
   * its academic_calendars row carries — optionally scoped.
   */
  async events(batchId?: number, semester?: number, type?: string) {
    const rows = await this.prisma.calendar_events.findMany({
      where: {
        event_type: type
          ? (type as calendar_event_type_enum)
          : undefined,
        academic_calendars: {
          batch_id: batchId,
          semester: semester,
        },
      },
      include: {
        academic_calendars: {
          select: { semester: true, batches: { select: { id: true, name: true } } },
        },
      },
      orderBy: { event_date: 'asc' },
    });

    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      description: r.description,
      event_date: r.event_date.toISOString(),
      event_type: r.event_type,
      start_time: r.start_time ? r.start_time.toISOString() : null,
      end_time: r.end_time ? r.end_time.toISOString() : null,
      batch_id: r.academic_calendars.batches.id,
      batch_label: r.academic_calendars.batches.name,
      semester: r.academic_calendars.semester,
    }));
  }

  /**
   * GET /me/iqac/calendar/quality
   * "This year"/"Last year" are real calendar_events counts in the same
   * Jul-Dec/Jan-Jun term window every other quality-domain page uses.
   * Target/attainment reuse the same iqac_metric_targets convention —
   * null (shown as "—") until IQAC sets a row for this AY.
   */
  async quality() {
    const thisTerm = currentTermRange(startOfToday());
    const lastYearTerm = priorYearTermRange(thisTerm);

    const [target, rows] = await Promise.all([
      this.targetFor('academic-calendar'),
      this.prisma.calendar_events.findMany({ select: { event_date: true } }),
    ]);

    const thisYear = rows.filter((r) => inRange(r.event_date, thisTerm)).length;
    const lastYear = rows.filter((r) =>
      inRange(r.event_date, lastYearTerm),
    ).length;

    return {
      this_year: thisYear,
      last_year: lastYear,
      target,
      attainment: target != null ? round1((thisYear / target) * 100) : null,
    };
  }
}
