import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { FacultyAttendanceService } from 'src/modules/faculty/faculty-attendance/faculty-attendance.service';

function formatDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/** Same academic-year convention used elsewhere in this codebase. */
function academicYearFor(date: Date): string {
  const calendarYear = date.getUTCFullYear();
  const academicStartYear =
    date.getUTCMonth() + 1 >= 6 ? calendarYear : calendarYear - 1;
  return `${academicStartYear}-${String((academicStartYear + 1) % 100).padStart(2, '0')}`;
}

function durationLabel(
  punchIn: string | null,
  punchOut: string | null,
): string | null {
  if (!punchIn || !punchOut) return null;
  const [inH, inM] = punchIn.split(':').map(Number);
  const [outH, outM] = punchOut.split(':').map(Number);
  const minutes = outH * 60 + outM - (inH * 60 + inM);
  if (minutes <= 0) return null;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h ${String(m).padStart(2, '0')}m`;
}

@Injectable()
export class HodEmployeeAttendanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly facultyAttendanceService: FacultyAttendanceService,
  ) {}

  /** Resolves the caller's own faculty row — never trusts a client-supplied id. */
  private async resolveFaculty(userId: number) {
    const faculty = await this.prisma.faculty.findUnique({
      where: { user_id: userId },
      select: {
        id: true,
        prefix: true,
        first_name: true,
        last_name: true,
        designation: true,
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
   * GET /hod/employee/attendance?academic_year= — the HOD's own biometric
   * attendance, reusing the same read path Admin/HoD already use to view
   * ANY faculty's attendance (FacultyAttendanceService.getForFaculty),
   * just force-scoped to the caller's own id instead of a client-supplied one.
   */
  async getMyAttendance(userId: number, academicYear?: string) {
    const faculty = await this.resolveFaculty(userId);
    const year = academicYear ?? academicYearFor(new Date());

    const [attendance, notesByDate] = await Promise.all([
      this.facultyAttendanceService.getForFaculty(faculty.id, year),
      this.getNotesByDate(faculty.id),
    ]);

    const months = attendance.months.map((month) => ({
      ...month,
      days: month.days.map((day) => ({
        ...day,
        duration: durationLabel(day.punch_in, day.punch_out),
        note: notesByDate.get(day.date) ?? null,
      })),
    }));

    const recentPunches = months
      .flatMap((m) => m.days)
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 10);

    return {
      faculty: {
        id: faculty.id,
        name: [faculty.prefix, faculty.first_name, faculty.last_name]
          .filter(Boolean)
          .join(' '),
        designation: faculty.designation,
      },
      overall: attendance.overall,
      months,
      recent_punches: recentPunches,
    };
  }

  /**
   * Real reasons for on_duty/on_leave days — an approved faculty_od_requests
   * has a purpose/place; an approved faculty_leaves has a reason/leave type.
   * FacultyAttendanceService's own day rows don't carry this through, so
   * it's fetched here separately rather than modifying that shared service.
   */
  private async getNotesByDate(facultyId: number) {
    const [ods, leaves] = await Promise.all([
      this.prisma.faculty_od_requests.findMany({
        where: {
          faculty_id: facultyId,
          hod_approval_status: 'approved',
          hr_approval_status: 'approved',
        },
        select: { from_date: true, to_date: true, purpose: true, place: true },
      }),
      this.prisma.faculty_leaves.findMany({
        where: {
          faculty_id: facultyId,
          hod_approval_status: 'approved',
          hr_approval_status: 'approved',
        },
        select: {
          from_date: true,
          to_date: true,
          reason: true,
          leave_types: { select: { name: true } },
        },
      }),
    ]);

    const notes = new Map<string, string>();
    for (const od of ods) {
      const label = ['On duty', od.purpose, od.place]
        .filter(Boolean)
        .join(' · ');
      const cursor = new Date(od.from_date);
      const end = new Date(od.to_date);
      while (cursor <= end) {
        notes.set(formatDate(cursor), label);
        cursor.setUTCDate(cursor.getUTCDate() + 1);
      }
    }
    for (const leave of leaves) {
      const label = [leave.leave_types?.name ?? 'Leave', leave.reason]
        .filter(Boolean)
        .join(' · ');
      const cursor = new Date(leave.from_date);
      const end = new Date(leave.to_date);
      while (cursor <= end) {
        notes.set(formatDate(cursor), label);
        cursor.setUTCDate(cursor.getUTCDate() + 1);
      }
    }
    return notes;
  }
}
