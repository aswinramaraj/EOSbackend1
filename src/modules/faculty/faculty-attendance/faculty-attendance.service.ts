import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { MarkFacultyAttendanceDto } from './dto/mark-attendance.dto';

const MONTH_LABELS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export interface DayRow {
  date: string;
  day: string;
  punch_in: string | null;
  punch_out: string | null;
  status: string;
}

function formatDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function formatTime(value: Date | string | null): string | null {
  if (!value) return null;
  if (typeof value === 'string') return value.slice(0, 5);
  return value.toISOString().slice(11, 16);
}

/**
 * Attendance % counts full_day as 1, half_day as 0.5, absent as 0. on_duty
 * and on_vacation are excused and excluded from the denominator entirely
 * (HR doesn't want an OD or a vacation to ever cost someone their attendance
 * %). Every other kind of approved leave (casual/sick/earned/...) counts
 * against the percentage exactly like an unexplained absence — in the
 * denominator, zero credit — since only vacation and OD are meant to be
 * "free". weekly_off and holiday never count either way.
 */
function computeStats(rows: { status: string }[]) {
  let full = 0;
  let half = 0;
  let absent = 0;
  let onLeave = 0;
  let onDuty = 0;
  let onVacation = 0;

  for (const row of rows) {
    if (row.status === 'full_day') full += 1;
    else if (row.status === 'half_day') half += 1;
    else if (row.status === 'absent') absent += 1;
    else if (row.status === 'on_leave') onLeave += 1;
    else if (row.status === 'on_duty') onDuty += 1;
    else if (row.status === 'on_vacation') onVacation += 1;
  }

  const denominator = full + half + absent + onLeave;
  const percentage =
    denominator > 0 ? Math.round(((full + half * 0.5) / denominator) * 100) : 0;

  return {
    full_days: full,
    half_days: half,
    absent,
    on_leave: onLeave,
    on_duty: onDuty,
    on_vacation: onVacation,
    attendance_percentage: percentage,
  };
}

@Injectable()
export class FacultyAttendanceService {
  constructor(private readonly prisma: PrismaService) {}

  /** GET /faculty/:id/attendance — Admin/HoD view-only. Empty until a punch-in source populates faculty_daily_attendance. */
  async getForFaculty(facultyId: number, academicYear?: string) {
    const faculty = await this.prisma.faculty.findUnique({
      where: { id: facultyId },
      select: { id: true },
    });
    if (!faculty) {
      throw new NotFoundException('Faculty not found');
    }

    const rows = await this.prisma.faculty_daily_attendance.findMany({
      where: {
        faculty_id: facultyId,
        academic_year: academicYear,
      },
      orderBy: { attendance_date: 'desc' },
      select: {
        attendance_date: true,
        punch_in: true,
        punch_out: true,
        status: true,
        academic_year: true,
      },
    });

    // Same precedence as the overview list (getOverview) — a real punch
    // wins outright; an approved leave/OD wins over a punch-less row for
    // the same day; otherwise the punch-less row stands. Without this, this
    // per-faculty view could disagree with the "All Faculty" list for the
    // exact same person and day.
    const leaveOdStatusByDate =
      await this.getApprovedLeaveOdStatusByDate(facultyId);

    const existingDates = new Set<string>();
    const effectiveRows = rows.map((row) => {
      const dateKey = formatDate(row.attendance_date);
      existingDates.add(dateKey);
      const hasPunch = row.punch_in !== null || row.punch_out !== null;
      const inferred = leaveOdStatusByDate.get(dateKey);
      return { ...row, status: !hasPunch && inferred ? inferred : row.status };
    });

    // A day with an approved leave/OD but no attendance row at all — e.g.
    // added via Vacation Management for a day biometric never touched —
    // still needs its own row here, not just a silent gap.
    for (const [dateKey, status] of leaveOdStatusByDate) {
      if (existingDates.has(dateKey)) continue;
      effectiveRows.push({
        attendance_date: new Date(`${dateKey}T00:00:00.000Z`),
        punch_in: null,
        punch_out: null,
        status,
        academic_year: academicYear ?? '',
      });
    }
    effectiveRows.sort(
      (a, b) => b.attendance_date.getTime() - a.attendance_date.getTime(),
    );

    const monthGroups = new Map<
      string,
      { label: string; days: DayRow[]; statuses: { status: string }[] }
    >();

    for (const row of effectiveRows) {
      const monthKey = row.attendance_date.toISOString().slice(0, 7);
      if (!monthGroups.has(monthKey)) {
        const monthLabel = `${MONTH_LABELS[row.attendance_date.getUTCMonth()]} ${row.attendance_date.getUTCFullYear()}`;
        monthGroups.set(monthKey, {
          label: monthLabel,
          days: [],
          statuses: [],
        });
      }
      const group = monthGroups.get(monthKey)!;
      group.days.push({
        date: formatDate(row.attendance_date),
        day: row.attendance_date.toLocaleDateString('en-US', {
          weekday: 'short',
          timeZone: 'UTC',
        }),
        punch_in: formatTime(row.punch_in),
        punch_out: formatTime(row.punch_out),
        status: row.status,
      });
      group.statuses.push({ status: row.status });
    }

    const months = Array.from(monthGroups.entries()).map(
      ([monthKey, group]) => ({
        month: monthKey,
        label: group.label,
        days: group.days,
        ...computeStats(group.statuses),
      }),
    );

    return {
      faculty_id: facultyId,
      overall: computeStats(effectiveRows),
      months,
    };
  }

  /** Every date this faculty has an approved leave or OD covering, mapped to
   * the status it should contribute — expanded from each request's
   * from_date..to_date range, not just today (unlike getOverview, which only
   * ever needs "today"). A leave is split into 'on_vacation' vs the generic
   * 'on_leave' based on its leave type's name — that's what lets vacation be
   * excused from the attendance % while every other leave type still counts
   * against it. */
  private async getApprovedLeaveOdStatusByDate(
    facultyId: number,
  ): Promise<Map<string, 'on_leave' | 'on_duty' | 'on_vacation'>> {
    const [approvedLeaves, approvedOds] = await Promise.all([
      this.prisma.faculty_leaves.findMany({
        where: {
          faculty_id: facultyId,
          hod_approval_status: 'approved',
          hr_approval_status: 'approved',
        },
        select: {
          from_date: true,
          to_date: true,
          leave_types: { select: { name: true } },
        },
      }),
      this.prisma.faculty_od_requests.findMany({
        where: {
          faculty_id: facultyId,
          hod_approval_status: 'approved',
          hr_approval_status: 'approved',
        },
        select: { from_date: true, to_date: true },
      }),
    ]);

    const byDate = new Map<string, 'on_leave' | 'on_duty' | 'on_vacation'>();
    function fillRange(
      ranges: { from_date: Date; to_date: Date }[],
      status: 'on_leave' | 'on_duty' | 'on_vacation',
    ) {
      for (const range of ranges) {
        const cursor = new Date(range.from_date);
        const end = new Date(range.to_date);
        while (cursor <= end) {
          byDate.set(formatDate(cursor), status);
          cursor.setUTCDate(cursor.getUTCDate() + 1);
        }
      }
    }
    for (const leave of approvedLeaves) {
      const isVacation =
        leave.leave_types?.name.toLowerCase().includes('vacation') ?? false;
      fillRange([leave], isVacation ? 'on_vacation' : 'on_leave');
    }
    fillRange(approvedOds, 'on_duty');
    return byDate;
  }

  /**
   * GET /me/faculty/attendance/overview — Admin/HoD. One row per faculty
   * (optionally scoped by department/search/academic year) plus today's
   * counts across all of them. View-only, same as getForFaculty.
   */
  async getOverview(
    departmentId?: number,
    academicYear?: string,
    search?: string,
  ) {
    const facultyRows = await this.prisma.faculty.findMany({
      where: {
        department_id: departmentId,
        status: 'active',
        OR: search
          ? [
              {
                first_name: { contains: search, mode: 'insensitive' as const },
              },
              { last_name: { contains: search, mode: 'insensitive' as const } },
            ]
          : undefined,
      },
      select: {
        id: true,
        prefix: true,
        first_name: true,
        last_name: true,
        profile_url: true,
        departments: {
          select: { id: true, name: true, code: true },
        },
      },
      orderBy: { id: 'asc' },
    });

    const facultyIds = facultyRows.map((f) => f.id);

    const attendanceRows = facultyIds.length
      ? await this.prisma.faculty_daily_attendance.findMany({
          where: {
            faculty_id: { in: facultyIds },
            academic_year: academicYear,
          },
          select: {
            faculty_id: true,
            status: true,
            attendance_date: true,
            punch_in: true,
            punch_out: true,
          },
        })
      : [];

    const today = new Date().toISOString().slice(0, 10);
    const todayDate = new Date(`${today}T00:00:00.000Z`);

    // A faculty member on HR-approved leave/OD today has no
    // faculty_daily_attendance row (that flow writes to faculty_leaves /
    // faculty_od_requests only) — without this cross-reference "today" would
    // silently drop them instead of counting them as on leave/duty/vacation.
    const [approvedLeavesToday, approvedOdToday] = facultyIds.length
      ? await Promise.all([
          this.prisma.faculty_leaves.findMany({
            where: {
              faculty_id: { in: facultyIds },
              hod_approval_status: 'approved',
              hr_approval_status: 'approved',
              from_date: { lte: todayDate },
              to_date: { gte: todayDate },
            },
            select: {
              faculty_id: true,
              leave_types: { select: { name: true } },
            },
          }),
          this.prisma.faculty_od_requests.findMany({
            where: {
              faculty_id: { in: facultyIds },
              hod_approval_status: 'approved',
              hr_approval_status: 'approved',
              from_date: { lte: todayDate },
              to_date: { gte: todayDate },
            },
            select: { faculty_id: true },
          }),
        ])
      : [[], []];
    // Split by leave type — vacation is excused from the attendance %, every
    // other leave type isn't, so "today" needs to know which one this is,
    // not just that a leave exists.
    const approvedVacationTodayIds = new Set(
      approvedLeavesToday
        .filter((r) => r.leave_types?.name.toLowerCase().includes('vacation'))
        .map((r) => r.faculty_id),
    );
    const approvedLeaveTodayIds = new Set(
      approvedLeavesToday
        .filter((r) => !r.leave_types?.name.toLowerCase().includes('vacation'))
        .map((r) => r.faculty_id),
    );
    const approvedOdTodayIds = new Set(
      approvedOdToday.map((r) => r.faculty_id),
    );

    const todayStatusByFaculty = new Map<
      number,
      { status: string; hasPunch: boolean }
    >();
    for (const row of attendanceRows) {
      if (row.attendance_date.toISOString().slice(0, 10) === today) {
        todayStatusByFaculty.set(row.faculty_id, {
          status: row.status,
          hasPunch: row.punch_in !== null || row.punch_out !== null,
        });
      }
    }

    // "Today" for each faculty member, in order of precedence:
    //  1. An explicit row backed by a real punch — actual evidence of what
    //     happened, an approved leave/OD/vacation can't override that.
    //  2. An approved vacation/OD/leave for today — wins over a same-day
    //     explicit row that has NO punch behind it (e.g. a stale manual
    //     "full_day" left over from before the leave existed), since that
    //     row is just as much a guess as the leave/OD is a fact.
    //  3. A punch-less explicit row on its own.
    //  4. Nothing at all — null ("not marked"), not a default status.
    function displayTodayStatus(facultyId: number): string | null {
      const explicit = todayStatusByFaculty.get(facultyId);
      if (explicit?.hasPunch) return explicit.status;
      if (approvedVacationTodayIds.has(facultyId)) return 'on_vacation';
      if (approvedOdTodayIds.has(facultyId)) return 'on_duty';
      if (approvedLeaveTodayIds.has(facultyId)) return 'on_leave';
      if (explicit) return explicit.status;
      return null;
    }

    // Every active faculty member counts toward "today" — not just those who
    // already have a punch/manual row — so the denominator is the real
    // roster size and doesn't grow as more attendance gets marked through
    // the day. Only the aggregate below treats "not marked" as absent — the
    // per-row today_status keeps the null so the UI can still say "Not
    // Marked" instead of a fabricated "Absent".
    const todayRows = facultyRows.map((f) => ({
      status: displayTodayStatus(f.id) ?? 'absent',
    }));

    const byFaculty = new Map<number, { status: string }[]>();
    for (const row of attendanceRows) {
      const list = byFaculty.get(row.faculty_id) ?? [];
      list.push({ status: row.status });
      byFaculty.set(row.faculty_id, list);
    }

    const rows = facultyRows.map((f) => {
      const displayStatus = displayTodayStatus(f.id);
      return {
        faculty_id: f.id,
        prefix: f.prefix,
        first_name: f.first_name,
        last_name: f.last_name,
        profile_url: f.profile_url,
        department: f.departments,
        // Lets a bulk "mark attendance for today" action warn before silently
        // overwriting someone who's already accounted for — present, on
        // leave/OD, or explicitly absent — instead of only exposing the
        // aggregate today-wide counts above. Null means genuinely
        // unmarked — no punch, no manual row, no approved leave/OD.
        today_status: displayStatus,
        // Absent with nothing explaining it — no punch, and no approved
        // leave/OD either — distinct from a formally-approved absence, for
        // views that only track approved leave (e.g. Vacation Management)
        // and would otherwise show nothing for these faculty at all.
        is_unaccounted_absent_today:
          displayStatus === null || displayStatus === 'absent',
        ...computeStats(byFaculty.get(f.id) ?? []),
      };
    });

    return {
      today: computeStats(todayRows),
      rows,
    };
  }

  /**
   * PUT /me/faculty/:id/attendance/:date — Admin/HR Payroll only. The only
   * write path into faculty_daily_attendance, since no punch/biometric
   * import exists. Upserts on [faculty_id, attendance_date] and leaves an
   * faculty_activity_log entry so there's an audit trail of who marked it —
   * faculty_daily_attendance itself has no marked-by/source column to record
   * that on the row.
   */
  async markAttendance(
    facultyId: number,
    dateStr: string,
    dto: MarkFacultyAttendanceDto,
    actorUserId: number,
  ) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      throw new BadRequestException('date must be in YYYY-MM-DD format');
    }

    const faculty = await this.prisma.faculty.findUnique({
      where: { id: facultyId },
      select: { id: true },
    });
    if (!faculty) {
      throw new NotFoundException('Faculty not found');
    }

    const attendanceDate = new Date(`${dateStr}T00:00:00.000Z`);
    if (Number.isNaN(attendanceDate.getTime())) {
      throw new BadRequestException('Invalid date');
    }

    const calendarYear = attendanceDate.getUTCFullYear();
    const academicStartYear =
      attendanceDate.getUTCMonth() + 1 >= 6 ? calendarYear : calendarYear - 1;
    const academicYear = `${academicStartYear}-${String(
      (academicStartYear + 1) % 100,
    ).padStart(2, '0')}`;

    const punchIn = dto.punch_in
      ? new Date(`1970-01-01T${dto.punch_in}:00.000Z`)
      : null;
    const punchOut = dto.punch_out
      ? new Date(`1970-01-01T${dto.punch_out}:00.000Z`)
      : null;

    const row = await this.prisma.faculty_daily_attendance.upsert({
      where: {
        faculty_id_attendance_date: {
          faculty_id: facultyId,
          attendance_date: attendanceDate,
        },
      },
      update: {
        status: dto.status,
        punch_in: punchIn,
        punch_out: punchOut,
        updated_at: new Date(),
      },
      create: {
        faculty_id: facultyId,
        attendance_date: attendanceDate,
        status: dto.status,
        academic_year: academicYear,
        punch_in: punchIn,
        punch_out: punchOut,
      },
    });

    await this.prisma.faculty_activity_log.create({
      data: {
        faculty_id: facultyId,
        description: `Attendance for ${dateStr} manually marked as "${dto.status}".`,
        created_by_user_id: actorUserId,
      },
    });

    return {
      faculty_id: row.faculty_id,
      date: dateStr,
      status: row.status,
      punch_in: formatTime(row.punch_in),
      punch_out: formatTime(row.punch_out),
    };
  }
}
