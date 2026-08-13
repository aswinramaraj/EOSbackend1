import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Same academic-year convention used elsewhere in this codebase. */
function academicYearFor(date: Date): string {
  const calendarYear = date.getUTCFullYear();
  const academicStartYear =
    date.getUTCMonth() + 1 >= 6 ? calendarYear : calendarYear - 1;
  return `${academicStartYear}-${String((academicStartYear + 1) % 100).padStart(2, '0')}`;
}

function pad2(n: number): string {
  return n.toString().padStart(2, '0');
}
function formatHHMM(value: Date): string {
  return `${pad2(value.getUTCHours())}:${pad2(value.getUTCMinutes())}`;
}
function slotMinutes(start: Date, end: Date): number {
  return Math.max(0, (end.getTime() - start.getTime()) / 60000);
}

/**
 * Monday..Friday only — matches hod-timetable.service.ts's own WEEKDAYS
 * convention (the standard working week; Saturday is an occasional
 * "working Saturday" exception, not a standing scheduled day, so it isn't
 * given a permanent column here either).
 */
function mondayToFriday(anchor: Date): Date[] {
  const day = anchor.getUTCDay();
  const monday = new Date(anchor);
  monday.setUTCDate(anchor.getUTCDate() - ((day + 6) % 7));
  return Array.from({ length: 5 }, (_, i) => {
    const d = new Date(monday);
    d.setUTCDate(monday.getUTCDate() + i);
    return d;
  });
}

@Injectable()
export class HodEmployeeTimetableService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The college's most recent academic_year that actually has any
   * timetable_slots — resolved from real data instead of the wall clock, so
   * a grid already populated under (say) "2025-26" doesn't render empty just
   * because the server's current date has since rolled into a later
   * academic year with nothing scheduled in it yet (same fix as
   * hod-timetable.service.ts's resolveActiveAcademicYear()).
   */
  private async resolveActiveAcademicYear(): Promise<string> {
    const latest = await this.prisma.timetable_slots.findFirst({
      orderBy: { academic_year: 'desc' },
      select: { academic_year: true },
    });
    return latest?.academic_year ?? academicYearFor(new Date());
  }

  private async resolveFaculty(userId: number) {
    const faculty = await this.prisma.faculty.findUnique({
      where: { user_id: userId },
      select: {
        id: true,
        prefix: true,
        first_name: true,
        last_name: true,
        office_room: true,
        department_id: true,
        departments: { select: { code: true } },
      },
    });
    if (!faculty) {
      throw new NotFoundException(
        'Faculty profile not found for the authenticated user',
      );
    }
    return faculty;
  }

  /**
   * Total periods in a day, for the free_hours stat. Reads the real,
   * institution-wide period_timings config table when populated; falls back
   * to the department's own widest scheduled period_number as a proxy only
   * for as long as that config hasn't been seeded yet.
   */
  private async periodsPerDay(departmentId: number, academicYear: string) {
    const configuredCount = await this.prisma.period_timings.count();
    if (configuredCount > 0) return configuredCount;

    const result = await this.prisma.timetable_slots.aggregate({
      where: {
        academic_year: academicYear,
        classes: { department_id: departmentId },
      },
      _max: { period_number: true },
    });
    return result._max.period_number ?? null;
  }

  private buildPeriod(slot: {
    id: number;
    period_number: number;
    start_time: Date;
    end_time: Date;
    subjects: {
      name: string;
      subject_code: string;
      course_type: string | null;
    };
    classes: { section: string; departments: { code: string } };
    venues: { name: string } | null;
  }) {
    const isLab =
      slot.subjects.course_type === 'PRACTICAL' ||
      slot.subjects.course_type === 'THEORY_WITH_PRACTICAL';
    return {
      id: slot.id,
      period_number: slot.period_number,
      start_time: formatHHMM(slot.start_time),
      end_time: formatHHMM(slot.end_time),
      minutes: slotMinutes(slot.start_time, slot.end_time),
      subject_name: slot.subjects.name,
      subject_code: slot.subjects.subject_code,
      class_label: `${slot.classes.departments.code}-${slot.classes.section}`,
      venue_name: slot.venues?.name ?? null,
      type: isLab ? ('lab' as const) : ('class' as const),
    };
  }

  private summarize(
    periods: ReturnType<HodEmployeeTimetableService['buildPeriod']>[],
    periodsPerDay: number | null,
  ) {
    const classes = periods.filter((p) => p.type === 'class').length;
    const labs = periods.filter((p) => p.type === 'lab').length;
    const totalMinutes = periods.reduce((sum, p) => sum + p.minutes, 0);
    const scheduledPeriods = new Set(periods.map((p) => p.period_number)).size;
    const freeHours =
      periodsPerDay != null
        ? Math.max(0, periodsPerDay - scheduledPeriods)
        : null;
    return {
      classes,
      labs,
      free_hours: freeHours,
      total_hours: Math.round((totalMinutes / 60) * 10) / 10,
    };
  }

  /** GET /hod/employee/timetable?date= — one day's schedule + a Mon-Sat date strip for navigation. */
  async getDay(userId: number, dateStr?: string) {
    const faculty = await this.resolveFaculty(userId);
    const anchor = dateStr
      ? new Date(`${dateStr}T00:00:00.000Z`)
      : new Date(new Date().toISOString().slice(0, 10));
    const academicYear = await this.resolveActiveAcademicYear();
    const dayOfWeek = anchor.getUTCDay();

    const [slots, periodsPerDay] = await Promise.all([
      this.prisma.timetable_slots.findMany({
        where: {
          faculty_id: faculty.id,
          day_of_week: dayOfWeek,
          academic_year: academicYear,
        },
        orderBy: { period_number: 'asc' },
        select: {
          id: true,
          period_number: true,
          start_time: true,
          end_time: true,
          subjects: {
            select: { name: true, subject_code: true, course_type: true },
          },
          classes: {
            select: { section: true, departments: { select: { code: true } } },
          },
          venues: { select: { name: true } },
        },
      }),
      this.periodsPerDay(faculty.department_id, academicYear),
    ]);

    const periods = slots.map((s) => this.buildPeriod(s));
    const weekDates = mondayToFriday(anchor).map((d) => ({
      date: d.toISOString().slice(0, 10),
      day_label: DAY_LABELS[d.getUTCDay()],
      day_number: d.getUTCDate(),
      is_selected:
        d.toISOString().slice(0, 10) === anchor.toISOString().slice(0, 10),
    }));

    return {
      faculty: {
        name: [faculty.prefix, faculty.first_name, faculty.last_name]
          .filter(Boolean)
          .join(' '),
        department_code: faculty.departments.code,
        office_room: faculty.office_room,
      },
      date: anchor.toISOString().slice(0, 10),
      day_label: DAY_LABELS[dayOfWeek],
      week_dates: weekDates,
      stats: this.summarize(periods, periodsPerDay),
      periods,
    };
  }

  /**
   * GET /hod/employee/timetable/week?date= — a Mon-Sat × period-slot grid.
   * Columns are every period configured in the real, institution-wide
   * period_timings table — a full day's worth, not just the periods this
   * one faculty happens to be scheduled in — so a faculty who only teaches
   * one period a week still gets a complete grid with the rest correctly
   * shown as free, matching the admin Timetable page's own full-day columns.
   * Only falls back to deriving columns from this faculty's own scheduled
   * slots (the previous behavior) for as long as period_timings is empty.
   */
  async getWeek(userId: number, dateStr?: string) {
    const faculty = await this.resolveFaculty(userId);
    const anchor = dateStr
      ? new Date(`${dateStr}T00:00:00.000Z`)
      : new Date(new Date().toISOString().slice(0, 10));
    const academicYear = await this.resolveActiveAcademicYear();

    const [slots, periodTimings] = await Promise.all([
      this.prisma.timetable_slots.findMany({
        where: { faculty_id: faculty.id, academic_year: academicYear },
        orderBy: [{ day_of_week: 'asc' }, { period_number: 'asc' }],
        select: {
          id: true,
          day_of_week: true,
          period_number: true,
          start_time: true,
          end_time: true,
          subjects: {
            select: { name: true, subject_code: true, course_type: true },
          },
          classes: {
            select: { section: true, departments: { select: { code: true } } },
          },
          venues: { select: { name: true } },
        },
      }),
      this.prisma.period_timings.findMany(),
    ]);
    const periodTimingsByNumber = new Map(
      periodTimings.map((p) => [p.period_number, p]),
    );

    const byDayAndPeriod = new Map<string, (typeof slots)[number]>();
    for (const slot of slots) {
      byDayAndPeriod.set(`${slot.day_of_week}-${slot.period_number}`, slot);
    }

    let columns: { period_number: number; start_time: string; end_time: string }[];
    let isBreakPeriod: (periodNumber: number) => boolean;

    if (periodTimings.length > 0) {
      columns = [...periodTimingsByNumber.values()]
        .sort((a, b) => a.period_number - b.period_number)
        .map((p) => ({
          period_number: p.period_number,
          start_time: formatHHMM(p.start_time),
          end_time: formatHHMM(p.end_time),
        }));
      isBreakPeriod = (periodNumber) =>
        periodTimingsByNumber.get(periodNumber)?.is_break ?? false;
    } else {
      // No period_timings config yet — fall back to deriving columns from
      // whichever period_numbers this faculty happens to be scheduled in
      // this week, with break inferred as the one period_number never used
      // for a real class anywhere in the department this year.
      const columnsByPeriod = new Map<
        number,
        { period_number: number; start_time: string; end_time: string }
      >();
      for (const slot of slots) {
        if (!columnsByPeriod.has(slot.period_number)) {
          columnsByPeriod.set(slot.period_number, {
            period_number: slot.period_number,
            start_time: formatHHMM(slot.start_time),
            end_time: formatHHMM(slot.end_time),
          });
        }
      }
      columns = [...columnsByPeriod.values()].sort(
        (a, b) => a.period_number - b.period_number,
      );

      const departmentSlots = columns.length
        ? await this.prisma.timetable_slots.findMany({
            where: {
              academic_year: academicYear,
              period_number: { in: columns.map((c) => c.period_number) },
              classes: { department_id: faculty.department_id },
            },
            select: { period_number: true },
          })
        : [];
      const usedPeriods = new Set(departmentSlots.map((s) => s.period_number));
      const inferredBreakPeriodNumber =
        columns
          .map((c) => c.period_number)
          .filter((p) => !usedPeriods.has(p))
          .sort((a, b) => a - b)[0] ?? null;
      isBreakPeriod = (periodNumber) => periodNumber === inferredBreakPeriodNumber;
    }

    const rows = mondayToFriday(anchor).map((d) => {
      const dayOfWeek = d.getUTCDay();
      const cells = columns.map((col) => {
        const slot = byDayAndPeriod.get(`${dayOfWeek}-${col.period_number}`);
        if (slot) return this.buildPeriod(slot);
        return {
          type: isBreakPeriod(col.period_number)
            ? ('break' as const)
            : ('free' as const),
        };
      });
      const periods = cells.filter(
        (c): c is ReturnType<HodEmployeeTimetableService['buildPeriod']> =>
          c.type === 'class' || c.type === 'lab',
      );
      return {
        date: d.toISOString().slice(0, 10),
        day_label: DAY_LABELS[dayOfWeek],
        stats: this.summarize(periods, columns.length),
        cells,
      };
    });

    return {
      faculty: {
        name: [faculty.prefix, faculty.first_name, faculty.last_name]
          .filter(Boolean)
          .join(' '),
        department_code: faculty.departments.code,
        office_room: faculty.office_room,
      },
      columns,
      rows,
    };
  }
}
