import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';

function startOfToday(): Date {
  return new Date(new Date().toISOString().slice(0, 10));
}

// toFacultyEntry() below takes `any` deliberately — its real input type is
// the faculty_daily_attendance query's inferred row shape, declared inline
// where the query runs; giving it a name here would drift out of sync with
// the query's own `select`. faculty is nullable only because faculty_id was
// relaxed for an unrelated Secretary-facing feature (see the Secretary
// module completion migration) — a Secretary's own attendance row has no
// faculty row at all, so such rows are filtered out (see facultyOnLeave/
// facultyOnDuty below) before this is ever called.
function toFacultyEntry(row: {
  faculty: {
    id: number;
    first_name: string;
    last_name: string;
    designation: string;
    departments: { name: string } | null;
  };
}) {
  return {
    id: row.faculty.id,
    name: `${row.faculty.first_name} ${row.faculty.last_name}`,
    department: row.faculty.departments?.name ?? null,
    designation: row.faculty.designation,
  };
}

@Injectable()
export class SecretaryDashboardService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * GET /me/secretary/dashboard/summary
   *
   * "Pending requests" is scoped to the caller's own submissions across the
   * four Secretary self-service flows (product requests, service requests,
   * venue bookings, media requests) — every one of those resources already
   * force-scopes a Secretary to own-only on GET, so this mirrors that rather
   * than exposing a college-wide pending count no existing endpoint grants a
   * Secretary access to.
   *
   * Attendance/faculty duty-leave figures are college-wide staff-tier data,
   * matching the unrestricted access Secretary already has on GET
   * /attendance (see AttendanceService.applyRoleScoping).
   *
   * There is no "students on leave" concept in the schema — attendance_
   * status_enum only has present/absent/on_duty, no leave value — so unlike
   * the design mockup's "Students on leave" tile, this reports "students
   * absent today" instead of inventing a leave semantic the data can't back.
   */
  async summary(currentUser: JwtPayload) {
    const today = startOfToday();
    // JS Date#getDay(): 0=Sun..6=Sat. timetable_slots.day_of_week uses the
    // same 1=Mon..6=Sat range with no Sunday value, so a Sunday query (0)
    // simply matches zero rows — no special-casing needed.
    const dayOfWeek = today.getDay();
    const userId = currentUser.sub;

    const [
      productPending,
      servicePending,
      venuePending,
      mediaPending,
      facultyDailyRows,
      studentsAbsentToday,
      studentsOnDutyToday,
      scheduledSessionsToday,
      markedSessionsToday,
    ] = await this.prisma.$transaction([
      this.prisma.secretary_product_requests.count({
        where: { requested_by_user_id: userId, status: 'pending' },
      }),
      this.prisma.secretary_service_requests.count({
        where: { requested_by_user_id: userId, status: 'pending' },
      }),
      this.prisma.venue_bookings.count({
        where: { booked_by_user_id: userId, status: 'pending' },
      }),
      this.prisma.media_requests.count({
        where: { requested_by_user_id: userId, status: 'pending' },
      }),
      this.prisma.faculty_daily_attendance.findMany({
        where: { attendance_date: today, status: { in: ['on_leave', 'on_duty'] } },
        select: {
          status: true,
          faculty: {
            select: {
              id: true,
              first_name: true,
              last_name: true,
              designation: true,
              departments: { select: { name: true } },
            },
          },
        },
      }),
      this.prisma.attendance_records.findMany({
        where: { attendance_date: today, status: 'absent' },
        select: { student_id: true },
        distinct: ['student_id'],
      }),
      this.prisma.attendance_records.findMany({
        where: { attendance_date: today, status: 'on_duty' },
        select: { student_id: true },
        distinct: ['student_id'],
      }),
      this.prisma.timetable_slots.findMany({
        where: { day_of_week: dayOfWeek },
        select: { class_id: true, subject_id: true },
        distinct: ['class_id', 'subject_id'],
      }),
      this.prisma.attendance_records.findMany({
        where: { attendance_date: today },
        select: { class_id: true, subject_id: true },
        distinct: ['class_id', 'subject_id'],
      }),
    ]);

    // Secretary-authored rows (staff_user_id set) have no faculty at all —
    // filtered out here since this widget is faculty-specific.
    const facultyOnLeave = facultyDailyRows.filter(
      (r) => r.status === 'on_leave' && r.faculty !== null,
    ) as Array<(typeof facultyDailyRows)[number] & { faculty: NonNullable<(typeof facultyDailyRows)[number]['faculty']> }>;
    const facultyOnDuty = facultyDailyRows.filter(
      (r) => r.status === 'on_duty' && r.faculty !== null,
    ) as Array<(typeof facultyDailyRows)[number] & { faculty: NonNullable<(typeof facultyDailyRows)[number]['faculty']> }>;

    const scheduledCount = scheduledSessionsToday.length;
    const markedCount = markedSessionsToday.length;

    return {
      date: today.toISOString().slice(0, 10),
      pending_requests: {
        product_requests: productPending,
        service_requests: servicePending,
        venue_bookings: venuePending,
        media_requests: mediaPending,
        total: productPending + servicePending + venuePending + mediaPending,
      },
      attendance_today: {
        // Approximate: compares distinct (class, subject) pairs scheduled
        // today via timetable_slots against distinct (class, subject) pairs
        // that already have at least one attendance_records row today.
        // attendance_records.subject_id is nullable (generic secretary
        // marking doesn't require a subject) while timetable_slots.subject_id
        // is not, so a null-subject marking never counts toward this ratio —
        // a known, documented approximation, not a bug.
        scheduled_sessions: scheduledCount,
        marked_sessions: markedCount,
        completion_percentage:
          scheduledCount > 0
            ? Math.round((markedCount / scheduledCount) * 100)
            : null,
      },
      students_today: {
        absent: studentsAbsentToday.length,
        on_duty: studentsOnDutyToday.length,
      },
      faculty_today: {
        on_leave: facultyOnLeave.length,
        on_duty: facultyOnDuty.length,
        on_leave_list: facultyOnLeave.map(toFacultyEntry),
        on_duty_list: facultyOnDuty.map(toFacultyEntry),
      },
    };
  }
}
