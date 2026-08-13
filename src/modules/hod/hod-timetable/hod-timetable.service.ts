import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';

const ROMAN_YEAR = ['I', 'II', 'III', 'IV', 'V', 'VI'];
function yearLabelForSemester(semester: number): string {
  const yearIndex = Math.ceil(semester / 2) - 1;
  return ROMAN_YEAR[yearIndex] ?? String(yearIndex + 1);
}

const DAY_LABELS: Record<number, string> = {
  1: 'Mon',
  2: 'Tue',
  3: 'Wed',
  4: 'Thu',
  5: 'Fri',
};
const WEEKDAYS = [1, 2, 3, 4, 5];

/** Same academic-year convention used elsewhere (e.g. hod-employee-timetable.service.ts) — an academic year starts in June. */
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
function timeToDate(hhmm: string): Date {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(Date.UTC(1970, 0, 1, h, m, 0));
}
function addMinutes(hhmm: string, minutes: number): string {
  const [h, m] = hhmm.split(':').map(Number);
  const total = h * 60 + m + minutes;
  return `${pad2(Math.floor(total / 60) % 24)}:${pad2(total % 60)}`;
}

const PERIODS_PER_DAY = 8;
// No period-timing config table exists anywhere in this schema (confirmed
// while building the Employee Timetable page). 08:45 is the institution's
// own real first-period start time, already seen on every real schedule
// this department has — used only as the anchor for periods that have
// literally zero scheduled data anywhere yet, so the grid always has a
// full 8-slot day to assign into instead of stopping wherever real data
// happens to run out.
const DEFAULT_FIRST_PERIOD_START = '08:45';
const STANDARD_PERIOD_MINUTES = 55;

function fullName(f: {
  prefix?: string | null;
  first_name: string;
  last_name: string;
}): string {
  return [f.prefix, f.first_name, f.last_name].filter(Boolean).join(' ');
}

function isLabCourseType(courseType: string | null): boolean {
  return courseType === 'PRACTICAL' || courseType === 'THEORY_WITH_PRACTICAL';
}

@Injectable()
export class HodTimetableService {
  constructor(private readonly prisma: PrismaService) {}

  private async resolveHodDepartment(userId: number) {
    const faculty = await this.prisma.faculty.findUnique({
      where: { user_id: userId },
      select: { id: true, department_id: true },
    });
    if (!faculty) {
      throw new NotFoundException(
        'Faculty profile not found for the authenticated user',
      );
    }
    return faculty;
  }

  private async getDepartmentClasses(departmentId: number) {
    const classes = await this.prisma.classes.findMany({
      where: { department_id: departmentId, current_semester: { not: null } },
      select: { id: true, section: true, current_semester: true },
      orderBy: [{ current_semester: 'desc' }, { section: 'asc' }],
    });
    return classes.map((c) => {
      const yearLabel = yearLabelForSemester(c.current_semester as number);
      return {
        class_id: c.id,
        section: c.section,
        semester: c.current_semester as number,
        short_label: `${yearLabel}-${c.section}`,
        label: `${yearLabel}-${c.section} · ${yearLabel} Year, Section ${c.section}`,
      };
    });
  }

  /**
   * The college's most recent academic_year that actually has any
   * timetable_slots — resolved from real data instead of the wall clock, so
   * a grid already populated under (say) "2024-25" doesn't render empty
   * just because the server's current date has since rolled into a later
   * academic year with nothing scheduled in it yet (see the same fix in
   * hod-my-class-attendance.service.ts). Not scoped to one department —
   * period timings are an institution-wide convention, not a per-department
   * one — so this picks up the year the college is actually running on.
   * Falls back to today's computed year only when there's no timetable
   * data anywhere yet.
   */
  private async resolveActiveAcademicYear() {
    const latest = await this.prisma.timetable_slots.findFirst({
      orderBy: { academic_year: 'desc' },
      select: { academic_year: true },
    });
    return latest?.academic_year ?? academicYearFor(new Date());
  }

  /**
   * Always returns exactly PERIODS_PER_DAY columns. Real ones (schedule
   * time taken from wherever in the college that period_number is actually
   * used this year) are marked is_real so break-vs-free can be derived
   * honestly for them; any period_number nobody has ever scheduled yet gets
   * a synthesized time (chained off the previous column, or the real
   * institutional day-start if nothing at all is scheduled) purely so the
   * grid has a full day of slots to assign into — its cells are always
   * "free", never "break", since there's no real evidence backing that.
   */
  private buildFullColumns(
    realColumns: { period_number: number; start_time: string; end_time: string }[],
  ) {
    const byPeriod = new Map(realColumns.map((c) => [c.period_number, c]));
    const columns: {
      period_number: number;
      start_time: string;
      end_time: string;
      is_real: boolean;
    }[] = [];
    let lastEnd: string | null = null;
    for (let p = 1; p <= PERIODS_PER_DAY; p++) {
      const real = byPeriod.get(p);
      if (real) {
        columns.push({ ...real, is_real: true });
        lastEnd = real.end_time;
      } else {
        const start = lastEnd ?? DEFAULT_FIRST_PERIOD_START;
        const end = addMinutes(start, STANDARD_PERIOD_MINUTES);
        columns.push({ period_number: p, start_time: start, end_time: end, is_real: false });
        lastEnd = end;
      }
    }
    return columns;
  }

  /**
   * Break-vs-free inference, used ONLY as a fallback for as long as
   * period_timings is unpopulated: across the whole week, college-wide, the
   * break period is the one that is never used for an actual class on ANY
   * day (every real teaching period gets used on at least one day somewhere
   * in the college; a true break never does). Only real columns are
   * eligible — a synthesized (never-scheduled anywhere) column has no
   * evidence either way, so it's treated as an ordinary assignable period,
   * not a break. Ties broken by the lowest period_number.
   */
  private resolveBreakPeriod(
    collegeSlots: { day_of_week: number; period_number: number }[],
    columns: { period_number: number; is_real: boolean }[],
  ): number | null {
    const usedPeriods = new Set(collegeSlots.map((s) => s.period_number));
    const neverUsed = columns
      .filter((c) => c.is_real && !usedPeriods.has(c.period_number))
      .map((c) => c.period_number)
      .sort((a, b) => a - b);
    return neverUsed[0] ?? null;
  }

  /**
   * Institution-wide period timings, read from the real period_timings
   * config table (start_time/end_time/is_break per period_number) — not
   * scoped to one department, matching the same "college-wide convention"
   * precedent as everything else on this page. Falls back to inferring from
   * real timetable_slots data (the previous behavior) only for as long as
   * period_timings hasn't been populated yet, so the grid still renders a
   * full day even before that config is seeded.
   */
  private async getPeriodColumns(academicYear: string): Promise<
    { period_number: number; start_time: string; end_time: string; is_real: boolean; is_break: boolean }[]
  > {
    const configured = await this.prisma.period_timings.findMany({
      orderBy: { period_number: 'asc' },
    });
    if (configured.length > 0) {
      return configured.map((p) => ({
        period_number: p.period_number,
        start_time: formatHHMM(p.start_time),
        end_time: formatHHMM(p.end_time),
        is_real: true,
        is_break: p.is_break,
      }));
    }

    const collegeSlots = await this.prisma.timetable_slots.findMany({
      where: { academic_year: academicYear },
      select: { day_of_week: true, period_number: true, start_time: true, end_time: true },
    });
    const realColumnsByPeriod = new Map<
      number,
      { period_number: number; start_time: string; end_time: string }
    >();
    for (const s of collegeSlots) {
      if (!realColumnsByPeriod.has(s.period_number)) {
        realColumnsByPeriod.set(s.period_number, {
          period_number: s.period_number,
          start_time: formatHHMM(s.start_time),
          end_time: formatHHMM(s.end_time),
        });
      }
    }
    const columns = this.buildFullColumns([...realColumnsByPeriod.values()]);
    const breakPeriodNumber = this.resolveBreakPeriod(collegeSlots, columns);
    return columns.map((c) => ({ ...c, is_break: c.period_number === breakPeriodNumber }));
  }

  /** GET /hod/timetable?class_id= */
  async getTimetable(userId: number, classId?: number) {
    const hod = await this.resolveHodDepartment(userId);
    const classes = await this.getDepartmentClasses(hod.department_id);
    if (classes.length === 0) {
      return {
        classes: [],
        selected_class_id: null,
        subjects: [],
        faculty_options: [],
        columns: [],
        rows: [],
      };
    }
    const selected = classes.find((c) => c.class_id === classId) ?? classes[0];
    const academicYear = await this.resolveActiveAcademicYear();

    const [classSubjects, facultyRows, classSlots] = await Promise.all([
      this.prisma.class_subjects.findMany({
        where: { class_id: selected.class_id, semester: selected.semester },
        select: {
          subject_id: true,
          subjects: { select: { name: true, subject_code: true } },
        },
        orderBy: { subject_id: 'asc' },
      }),
      this.prisma.faculty.findMany({
        where: { department_id: hod.department_id, status: 'active' },
        select: { id: true, prefix: true, first_name: true, last_name: true },
        orderBy: { first_name: 'asc' },
      }),
      this.prisma.timetable_slots.findMany({
        where: { class_id: selected.class_id, academic_year: academicYear },
        select: {
          id: true,
          day_of_week: true,
          period_number: true,
          start_time: true,
          end_time: true,
          subject_id: true,
          subjects: { select: { name: true, subject_code: true, course_type: true } },
          faculty_id: true,
          faculty: { select: { prefix: true, first_name: true, last_name: true } },
          venues: { select: { name: true } },
        },
      }),
    ]);

    const columns = await this.getPeriodColumns(academicYear);

    const subjectMappings =
      classSubjects.length > 0
        ? await this.prisma.faculty_subject_class_mapping.findMany({
            where: {
              subject_id: { in: classSubjects.map((cs) => cs.subject_id) },
              academic_year: academicYear,
              classes: { department_id: hod.department_id },
            },
            select: { subject_id: true, faculty_id: true },
          })
        : [];
    const facultyIdsBySubject = new Map<number, Set<number>>();
    for (const m of subjectMappings) {
      const set = facultyIdsBySubject.get(m.subject_id) ?? new Set<number>();
      set.add(m.faculty_id);
      facultyIdsBySubject.set(m.subject_id, set);
    }

    const slotByDayPeriod = new Map(
      classSlots.map((s) => [`${s.day_of_week}-${s.period_number}`, s]),
    );

    const rows = WEEKDAYS.map((dayOfWeek) => ({
      day_of_week: dayOfWeek,
      day_label: DAY_LABELS[dayOfWeek],
      cells: columns.map((col) => {
        const slot = slotByDayPeriod.get(`${dayOfWeek}-${col.period_number}`);
        if (slot) {
          return {
            period_number: col.period_number,
            type: isLabCourseType(slot.subjects.course_type)
              ? ('lab' as const)
              : ('class' as const),
            slot_id: slot.id,
            subject_id: slot.subject_id,
            subject_name: slot.subjects.name,
            subject_code: slot.subjects.subject_code,
            faculty_id: slot.faculty_id,
            faculty_name: fullName(slot.faculty),
            venue_name: slot.venues?.name ?? null,
          };
        }
        return {
          period_number: col.period_number,
          type: col.is_break ? ('break' as const) : ('free' as const),
        };
      }),
    }));

    return {
      classes: classes.map((c) => ({
        class_id: c.class_id,
        short_label: c.short_label,
        label: c.label,
      })),
      selected_class_id: selected.class_id,
      selected_class_label: selected.short_label,
      subjects: classSubjects.map((cs) => ({
        subject_id: cs.subject_id,
        name: cs.subjects.name,
        code: cs.subjects.subject_code,
        faculty_ids: [...(facultyIdsBySubject.get(cs.subject_id) ?? [])],
      })),
      faculty_options: facultyRows.map((f) => ({
        faculty_id: f.id,
        name: fullName(f),
      })),
      columns: columns.map((c) => ({
        period_number: c.period_number,
        start_time: c.start_time,
        end_time: c.end_time,
      })),
      rows,
    };
  }

  /** PUT /hod/timetable/slot — creates the period if empty, or reassigns faculty (and optionally subject) if already scheduled. */
  async setSlot(
    userId: number,
    classId: number,
    dayOfWeek: number,
    periodNumber: number,
    subjectId: number,
    facultyId: number,
  ) {
    const hod = await this.resolveHodDepartment(userId);

    const klass = await this.prisma.classes.findUnique({
      where: { id: classId },
      select: { department_id: true, current_semester: true },
    });
    if (!klass || klass.department_id !== hod.department_id) {
      throw new ForbiddenException('This class is not in your department');
    }
    const faculty = await this.prisma.faculty.findUnique({
      where: { id: facultyId },
      select: { department_id: true },
    });
    if (!faculty || faculty.department_id !== hod.department_id) {
      throw new ForbiddenException('This faculty is not in your department');
    }
    const classSubject = await this.prisma.class_subjects.findFirst({
      where: {
        class_id: classId,
        subject_id: subjectId,
        semester: klass.current_semester ?? undefined,
      },
    });
    if (!classSubject) {
      throw new BadRequestException(
        'This subject is not scheduled for this class this semester',
      );
    }

    const existing = await this.prisma.timetable_slots.findFirst({
      where: {
        class_id: classId,
        day_of_week: dayOfWeek,
        period_number: periodNumber,
      },
      orderBy: { academic_year: 'desc' },
    });

    if (existing) {
      await this.prisma.timetable_slots.update({
        where: { id: existing.id },
        data: { faculty_id: facultyId, subject_id: subjectId },
      });
      return { status: 'ok' as const };
    }

    const academicYear = await this.resolveActiveAcademicYear();
    const columns = await this.getPeriodColumns(academicYear);
    const column = columns.find((c) => c.period_number === periodNumber);
    if (!column) {
      throw new BadRequestException(
        `period_number ${periodNumber} is not a configured period`,
      );
    }

    await this.prisma.timetable_slots.create({
      data: {
        class_id: classId,
        subject_id: subjectId,
        faculty_id: facultyId,
        day_of_week: dayOfWeek,
        period_number: periodNumber,
        start_time: timeToDate(column.start_time),
        end_time: timeToDate(column.end_time),
        academic_year: academicYear,
        semester: klass.current_semester ?? 1,
      },
    });
    return { status: 'ok' as const };
  }

  /** DELETE /hod/timetable/slot/:id — clears the assignment back to free/break. */
  async clearSlot(userId: number, slotId: number) {
    const hod = await this.resolveHodDepartment(userId);
    const slot = await this.prisma.timetable_slots.findUnique({
      where: { id: slotId },
      select: { classes: { select: { department_id: true } } },
    });
    if (!slot || slot.classes.department_id !== hod.department_id) {
      throw new ForbiddenException('This period is not in your department');
    }
    await this.prisma.timetable_slots.delete({ where: { id: slotId } });
    return { status: 'ok' as const };
  }
}
