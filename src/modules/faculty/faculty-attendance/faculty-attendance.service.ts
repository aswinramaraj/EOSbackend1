import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';

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
 * Attendance % counts full_day as 1, half_day as 0.5, absent as 0 — on_duty
 * and on_leave are excused and excluded from the denominator entirely (shown
 * as their own separate tile, not folded into the percentage). weekly_off
 * and holiday never count either way. This mirrors the reference design's
 * numbers exactly (25 full + 3 half + 3 absent -> 85%).
 */
function computeStats(rows: { status: string }[]) {
  let full = 0;
  let half = 0;
  let absent = 0;
  let onDutyOrLeave = 0;

  for (const row of rows) {
    if (row.status === 'full_day') full += 1;
    else if (row.status === 'half_day') half += 1;
    else if (row.status === 'absent') absent += 1;
    else if (row.status === 'on_duty' || row.status === 'on_leave')
      onDutyOrLeave += 1;
  }

  const denominator = full + half + absent;
  const percentage =
    denominator > 0 ? Math.round(((full + half * 0.5) / denominator) * 100) : 0;

  return {
    full_days: full,
    half_days: half,
    absent,
    on_duty_or_leave: onDutyOrLeave,
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

    const monthGroups = new Map<
      string,
      { label: string; days: DayRow[]; statuses: { status: string }[] }
    >();

    for (const row of rows) {
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
      overall: computeStats(rows),
      months,
    };
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
        first_name: true,
        last_name: true,
        profile_url: true,
        departments: { select: { id: true, name: true, code: true } },
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
          select: { faculty_id: true, status: true, attendance_date: true },
        })
      : [];

    const today = new Date().toISOString().slice(0, 10);
    const todayRows = attendanceRows.filter(
      (row) => row.attendance_date.toISOString().slice(0, 10) === today,
    );

    const byFaculty = new Map<number, { status: string }[]>();
    for (const row of attendanceRows) {
      const list = byFaculty.get(row.faculty_id) ?? [];
      list.push({ status: row.status });
      byFaculty.set(row.faculty_id, list);
    }

    const rows = facultyRows.map((f) => ({
      faculty_id: f.id,
      first_name: f.first_name,
      last_name: f.last_name,
      profile_url: f.profile_url,
      department: f.departments,
      ...computeStats(byFaculty.get(f.id) ?? []),
    }));

    return {
      today: computeStats(todayRows),
      rows,
    };
  }
}
