import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';

function startOfToday(): Date {
  return new Date(new Date().toISOString().slice(0, 10));
}

type DashboardPeriod = 'term' | 'year';

/**
 * "Year" uses a June academic-year cutoff, mirroring
 * HrRequestsService.academicYearFor (src/modules/hr/hr-requests) so this
 * doesn't invent a second, inconsistent convention for the same concept.
 * "Term" has no single global value anywhere in the schema (semesters are
 * per-batch via academic_calendars) — Odd = Jul-Dec / Even = Jan-Jun is the
 * same institution-wide convention the frontend already displays via
 * semesterParityLabel, applied here as a calendar range rather than a
 * per-batch lookup.
 */
function getPeriodRange(
  period: DashboardPeriod,
  today: Date,
): { start: Date; end: Date; label: string } {
  const calendarYear = today.getUTCFullYear();
  const month = today.getUTCMonth() + 1;

  if (period === 'year') {
    const academicStartYear = month >= 6 ? calendarYear : calendarYear - 1;
    return {
      start: new Date(Date.UTC(academicStartYear, 5, 1)),
      end: new Date(Date.UTC(academicStartYear + 1, 4, 31)),
      label: `Academic year ${academicStartYear}-${String((academicStartYear + 1) % 100).padStart(2, '0')}`,
    };
  }

  if (month >= 7) {
    return {
      start: new Date(Date.UTC(calendarYear, 6, 1)),
      end: new Date(Date.UTC(calendarYear, 11, 31)),
      label: 'Odd Semester',
    };
  }
  return {
    start: new Date(Date.UTC(calendarYear, 0, 1)),
    end: new Date(Date.UTC(calendarYear, 5, 30)),
    label: 'Even Semester',
  };
}

@Injectable()
export class PrincipalDashboardService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * GET /me/principal/dashboard/summary
   *
   * Institution-wide, read-only figures a Principal has no class/department
   * scope restriction on (unlike HOD/Faculty). Every figure here is a direct
   * count/aggregate over real rows — nothing is estimated or hardcoded.
   *
   * "attendance_percentage_today" divides present-today by
   * (present + absent + on_duty)-today, i.e. only students who were actually
   * marked today — a day with no attendance taken yet returns null rather
   * than 0%, so the dashboard can distinguish "nobody has attended" from
   * "nobody has been marked yet".
   *
   * There is no "pending approvals" figure here: unlike Secretary's
   * dashboard (which scopes to the caller's own four self-service request
   * types), a Principal-wide "pending approvals" would mean picking which
   * of a dozen+ unrelated request tables (leaves, ODs, bonafide,
   * revaluation, purchase/service indents, hostel...) count as
   * "Principal-level" — no existing endpoint or schema concept defines that
   * scope, so it is intentionally omitted rather than guessed at.
   */
  async summary() {
    const today = startOfToday();

    const [
      studentsTotalActive,
      studentsPresentToday,
      studentsAbsentToday,
      studentsOnDutyToday,
      facultyTotalActive,
      facultyDailyRows,
      nonTeachingStaffTotalActive,
      departmentsTotal,
    ] = await this.prisma.$transaction([
      this.prisma.students.count({ where: { status: 'active' } }),
      this.prisma.attendance_records.findMany({
        where: { attendance_date: today, status: 'present' },
        select: { student_id: true },
        distinct: ['student_id'],
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
      this.prisma.faculty.count({ where: { status: 'active' } }),
      this.prisma.faculty_daily_attendance.findMany({
        where: { attendance_date: today },
        select: { status: true },
      }),
      this.prisma.non_teaching_staff.count({ where: { status: 'active' } }),
      this.prisma.departments.count(),
    ]);

    const presentCount = studentsPresentToday.length;
    const absentCount = studentsAbsentToday.length;
    const onDutyCount = studentsOnDutyToday.length;
    const markedTotal = presentCount + absentCount + onDutyCount;

    const facultyReportedToday = facultyDailyRows.filter((r) =>
      ['full_day', 'half_day', 'on_duty'].includes(r.status),
    ).length;
    const facultyOnLeaveToday = facultyDailyRows.filter(
      (r) => r.status === 'on_leave',
    ).length;

    return {
      date: today.toISOString().slice(0, 10),
      students: {
        total_active: studentsTotalActive,
        present_today: presentCount,
        absent_today: absentCount,
        on_duty_today: onDutyCount,
        attendance_percentage_today:
          markedTotal > 0
            ? Math.round((presentCount / markedTotal) * 100 * 10) / 10
            : null,
      },
      faculty: {
        total_active: facultyTotalActive,
        reported_today: facultyReportedToday,
        on_leave_today: facultyOnLeaveToday,
        // Only populated once faculty_daily_attendance has rows for today —
        // an empty rollup means nobody has been marked yet, not zero staff.
        attendance_marked_today: facultyDailyRows.length > 0,
      },
      non_teaching_staff: {
        total_active: nonTeachingStaffTotalActive,
      },
      departments: {
        total: departmentsTotal,
      },
    };
  }

  /**
   * GET /me/principal/dashboard/summary?period=term|year
   *
   * A separate method (not a branch inside `summary()`) so the already-
   * validated `summary()` (period=today, the default) stays byte-for-byte
   * unchanged — this only adds a new code path.
   *
   * Deliberately omitted vs. the reference design: "intake filled to X%"
   * (quotas has no seat-capacity field — nothing to divide by) and
   * "attrition %" (faculty.status has no transition timestamp — no
   * "became inactive on this date" to compute a rate from). Both would be
   * guesses, not aggregates, so neither is included.
   *
   * "students_below_threshold" / "best_month" aggregate every
   * attendance_records row in the period in memory — fine at this
   * institution's current data volume, but would want a DB-side GROUP BY
   * if attendance history grows into the millions of rows.
   */
  async summaryForPeriod(period: DashboardPeriod) {
    const today = startOfToday();
    const { start, end, label } = getPeriodRange(period, today);

    const [
      studentsTotalActive,
      newAdmissions,
      facultyTotalActive,
      newHires,
      nonTeachingStaffTotalActive,
      departmentsTotal,
      attendanceRows,
    ] = await this.prisma.$transaction([
      this.prisma.students.count({ where: { status: 'active' } }),
      this.prisma.students.count({
        where: { admission_date: { gte: start, lte: end } },
      }),
      this.prisma.faculty.count({ where: { status: 'active' } }),
      this.prisma.faculty.count({
        where: { date_of_joining: { gte: start, lte: end } },
      }),
      this.prisma.non_teaching_staff.count({ where: { status: 'active' } }),
      this.prisma.departments.count(),
      this.prisma.attendance_records.findMany({
        where: { attendance_date: { gte: start, lte: end } },
        select: { status: true, attendance_date: true, student_id: true },
      }),
    ]);

    const ATTENDANCE_THRESHOLD_PERCENT = 75;
    const presentTotal = attendanceRows.filter(
      (r) => r.status === 'present',
    ).length;
    const meanPercentage =
      attendanceRows.length > 0
        ? Math.round((presentTotal / attendanceRows.length) * 1000) / 10
        : null;

    const byStudent = new Map<number, { present: number; total: number }>();
    const byMonth = new Map<string, { present: number; total: number }>();
    for (const r of attendanceRows) {
      const s = byStudent.get(r.student_id) ?? { present: 0, total: 0 };
      s.total += 1;
      if (r.status === 'present') s.present += 1;
      byStudent.set(r.student_id, s);

      const monthKey = r.attendance_date.toISOString().slice(0, 7);
      const m = byMonth.get(monthKey) ?? { present: 0, total: 0 };
      m.total += 1;
      if (r.status === 'present') m.present += 1;
      byMonth.set(monthKey, m);
    }

    let studentsBelowThreshold = 0;
    for (const s of byStudent.values()) {
      if (
        s.total > 0 &&
        (s.present / s.total) * 100 < ATTENDANCE_THRESHOLD_PERCENT
      )
        studentsBelowThreshold += 1;
    }

    let bestMonthKey: string | null = null;
    let bestMonthPct = -1;
    for (const [key, v] of byMonth.entries()) {
      if (v.total === 0) continue;
      const pct = (v.present / v.total) * 100;
      if (pct > bestMonthPct) {
        bestMonthPct = pct;
        bestMonthKey = key;
      }
    }
    const bestMonthLabel = bestMonthKey
      ? new Date(`${bestMonthKey}-01T00:00:00Z`).toLocaleDateString('en-IN', {
          month: 'long',
          timeZone: 'UTC',
        })
      : null;

    return {
      period,
      period_label: label,
      students: {
        total_active: studentsTotalActive,
        new_admissions: newAdmissions,
      },
      faculty: { total_active: facultyTotalActive, new_hires: newHires },
      non_teaching_staff: { total_active: nonTeachingStaffTotalActive },
      departments: { total: departmentsTotal },
      attendance: {
        percentage: meanPercentage,
        students_below_threshold: studentsBelowThreshold,
        best_month: bestMonthLabel,
      },
    };
  }

  /**
   * GET /me/principal/dashboard/insights
   *
   * Placement command center + Needs-attention flags. Everything here is a
   * real aggregate over existing tables — no arrears/pass-fail flag is
   * included: exam_marks has no internal/external split and
   * exam_pass_rules_settings' min_external_marks can't be applied to a
   * single combined mark, so a "students with arrears" figure can't be
   * computed correctly without reusing the exams/results module's own pass
   * logic — deferred rather than guessed.
   */
  async insights() {
    const [placement, attentionFlags, campus] = await Promise.all([
      this.placementSummary(),
      this.attentionFlags(),
      this.campusInfrastructure(),
    ]);
    return { placement, attention_flags: attentionFlags, campus };
  }

  /**
   * `venues.venue_type`/`timetable_slots.venue_id` are real (query.md #1
   * ran) — 2 real rooms exist (1 classroom, 1 lab) but none of the 68
   * `timetable_slots` rows have `venue_id` backfilled yet, so a real "N of M
   * in use right now" figure can't be computed (would always read 0). Shows
   * a real room count instead, same tier of honesty as the Facilities →
   * Classrooms/Laboratories pages, until that backfill happens. "Maintenance"
   * is relabelled "Service requests": secretary_service_requests has no
   * category field, so it covers any Secretary-handled request, not
   * specifically facility maintenance — labelling it "Maintenance" would
   * claim a category the data doesn't distinguish.
   */
  private async campusInfrastructure() {
    const today = startOfToday();

    const [
      roomCounts,
      booksBorrowedToday,
      booksReturnedToday,
      routesTotal,
      busesReportingToday,
      hostelRoomCapacities,
      hostelOccupied,
      pendingServiceRequests,
    ] = await Promise.all([
      this.tryLoadRoomCounts(),
      this.prisma.book_borrow_records.count({
        where: { borrowed_date: today },
      }),
      this.prisma.book_borrow_records.count({
        where: { returned_date: today },
      }),
      this.prisma.transport_routes.count(),
      this.prisma.buses.findMany({
        where: {
          bus_live_locations: { some: { updated_at: { gte: today } } },
          route_id: { not: null },
        },
        select: { route_id: true },
      }),
      this.prisma.hostel_rooms.aggregate({ _sum: { capacity: true } }),
      this.prisma.student_hostel_mapping.count(),
      this.prisma.secretary_service_requests.count({
        where: { status: 'pending' },
      }),
    ]);

    const routesRunning = new Set(busesReportingToday.map((b) => b.route_id))
      .size;
    const hostelCapacity = hostelRoomCapacities._sum.capacity ?? 0;

    return {
      classrooms: roomCounts,
      library: {
        book_transactions_today: booksBorrowedToday + booksReturnedToday,
      },
      transport: { routes_running: routesRunning, routes_total: routesTotal },
      hostel: {
        occupancy_percentage:
          hostelCapacity > 0
            ? Math.round((hostelOccupied / hostelCapacity) * 1000) / 10
            : null,
        residents: hostelOccupied,
        capacity: hostelCapacity,
      },
      service_requests: { pending: pendingServiceRequests },
    };
  }

  /**
   * Reads real classroom/lab counts via `$queryRaw` rather than the typed
   * client (predates the `prisma db pull` that synced `venue_type` into
   * schema.prisma). `tracked: false` only if query.md #1 genuinely hasn't
   * run — fine to convert to typed calls whenever this file is next touched.
   */
  private async tryLoadRoomCounts(): Promise<{
    tracked: boolean;
    classrooms_count: number;
    labs_count: number;
  }> {
    try {
      const rows = await this.prisma.$queryRaw<
        { venue_type: string; count: bigint }[]
      >`
        SELECT venue_type, count(*) FROM venues
        WHERE venue_type IN ('classroom', 'lab')
        GROUP BY venue_type
      `;
      const byType = new Map(rows.map((r) => [r.venue_type, Number(r.count)]));
      return {
        tracked: true,
        classrooms_count: byType.get('classroom') ?? 0,
        labs_count: byType.get('lab') ?? 0,
      };
    } catch {
      return { tracked: false, classrooms_count: 0, labs_count: 0 };
    }
  }

  private async placementSummary() {
    const today = startOfToday();
    const weekFromNow = new Date(today);
    weekFromNow.setDate(weekFromNow.getDate() + 7);

    const [drives, applications, registeredStudentIds] = await Promise.all([
      this.prisma.placement_drives.findMany({
        select: {
          id: true,
          company_id: true,
          status: true,
          scheduled_date: true,
        },
      }),
      this.prisma.student_drive_applications.findMany({
        select: { status: true, offered_package: true },
      }),
      this.prisma.student_drive_applications.findMany({
        select: { student_id: true },
        distinct: ['student_id'],
      }),
    ]);

    const companiesVisited = new Set(drives.map((d) => d.company_id)).size;
    const drivesThisWeek = drives.filter(
      (d) =>
        d.status === 'scheduled' &&
        d.scheduled_date >= today &&
        d.scheduled_date <= weekFromNow,
    ).length;

    const placedApplications = applications.filter(
      (a) => a.status === 'placed',
    );
    const placedPackages = placedApplications
      .map((a) =>
        a.offered_package != null ? Number(a.offered_package) : null,
      )
      .filter((p): p is number => p != null);

    return {
      registered: registeredStudentIds.length,
      companies_visited: companiesVisited,
      offers_released: placedApplications.length,
      highest_package_lpa:
        placedPackages.length > 0 ? Math.max(...placedPackages) : null,
      average_package_lpa:
        placedPackages.length > 0
          ? Math.round(
              (placedPackages.reduce((a, b) => a + b, 0) /
                placedPackages.length) *
                100,
            ) / 100
          : null,
      drives_this_week: drivesThisWeek,
    };
  }

  /** Department attendance below ATTENDANCE_THRESHOLD_PERCENT (75%, this codebase's existing student-attendance condonation threshold), over the last 7 days. */
  private async departmentAttendanceFlags() {
    const ATTENDANCE_THRESHOLD_PERCENT = 75;
    const today = startOfToday();
    const sevenDaysAgo = new Date(today);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);

    const records = await this.prisma.attendance_records.findMany({
      where: { attendance_date: { gte: sevenDaysAgo, lte: today } },
      select: {
        status: true,
        classes: {
          select: { departments: { select: { name: true, code: true } } },
        },
      },
    });

    const byDept = new Map<
      string,
      { name: string; present: number; total: number }
    >();
    for (const r of records) {
      const dept = r.classes.departments;
      const entry = byDept.get(dept.code) ?? {
        name: dept.name,
        present: 0,
        total: 0,
      };
      entry.total += 1;
      if (r.status === 'present') entry.present += 1;
      byDept.set(dept.code, entry);
    }

    return Array.from(byDept.entries())
      .filter(([, v]) => v.total > 0)
      .map(([code, v]) => ({
        code,
        name: v.name,
        percentage: Math.round((v.present / v.total) * 1000) / 10,
      }))
      .filter((d) => d.percentage < ATTENDANCE_THRESHOLD_PERCENT)
      .sort((a, b) => a.percentage - b.percentage)
      .map((d) => ({
        type: 'attendance' as const,
        title: `${d.code} attendance at ${d.percentage}%`,
        description: `Below the ${ATTENDANCE_THRESHOLD_PERCENT}% threshold over the last 7 days`,
      }));
  }

  /** Institution-wide fee demand vs collected, from real student_fee_demand_mapping + fee_payments rows. */
  private async feesOutstandingFlag() {
    const [demandMappings, paidByMapping] = await Promise.all([
      this.prisma.student_fee_demand_mapping.findMany({
        select: { id: true, student_id: true, total_amount: true },
      }),
      this.prisma.fee_payments.groupBy({
        by: ['student_fee_demand_mapping_id'],
        _sum: { amount_paid: true },
      }),
    ]);

    const paidMap = new Map(
      paidByMapping.map((p) => [
        p.student_fee_demand_mapping_id,
        Number(p._sum.amount_paid ?? 0),
      ]),
    );

    let totalOutstanding = 0;
    const studentsWithOutstanding = new Set<number>();
    for (const m of demandMappings) {
      const outstanding = Number(m.total_amount) - (paidMap.get(m.id) ?? 0);
      if (outstanding > 0) {
        totalOutstanding += outstanding;
        studentsWithOutstanding.add(m.student_id);
      }
    }

    if (totalOutstanding <= 0) return null;

    const crores = Math.round((totalOutstanding / 1e7) * 100) / 100;
    return {
      type: 'fees' as const,
      title:
        crores >= 1
          ? `₹${crores} Cr fees outstanding`
          : `₹${Math.round(totalOutstanding).toLocaleString('en-IN')} fees outstanding`,
      description: `${studentsWithOutstanding.size.toLocaleString('en-IN')} students with an unpaid balance`,
    };
  }

  /** Faculty with a scheduled weekly teaching load above WORKLOAD_THRESHOLD_HOURS, from real timetable_slots durations. */
  private async facultyWorkloadFlags() {
    const WORKLOAD_THRESHOLD_HOURS = 20;
    const slots = await this.prisma.timetable_slots.findMany({
      select: {
        faculty_id: true,
        start_time: true,
        end_time: true,
        faculty: { select: { departments: { select: { code: true } } } },
      },
    });

    const byFaculty = new Map<number, { hours: number; deptCode: string }>();
    for (const s of slots) {
      const hours = (s.end_time.getTime() - s.start_time.getTime()) / 3_600_000;
      const entry = byFaculty.get(s.faculty_id) ?? {
        hours: 0,
        deptCode: s.faculty.departments.code,
      };
      entry.hours += hours;
      byFaculty.set(s.faculty_id, entry);
    }

    const overloaded = Array.from(byFaculty.values()).filter(
      (f) => f.hours > WORKLOAD_THRESHOLD_HOURS,
    );
    if (overloaded.length === 0) return null;

    const deptCodes = Array.from(
      new Set(overloaded.map((f) => f.deptCode)),
    ).sort();
    return {
      type: 'workload' as const,
      title: `Faculty workload above ${WORKLOAD_THRESHOLD_HOURS} hrs`,
      description: `${overloaded.length} faculty across ${deptCodes.join(', ')}`,
    };
  }

  /** Department course-completion rate below COMPLETION_THRESHOLD_PERCENT, from real lesson_plan_sessions.is_covered rows. */
  private async courseCompletionFlags() {
    const COMPLETION_THRESHOLD_PERCENT = 60;
    const sessions = await this.prisma.lesson_plan_sessions.findMany({
      select: {
        is_covered: true,
        lesson_plans: {
          select: {
            faculty: { select: { departments: { select: { code: true } } } },
          },
        },
      },
    });

    const byDept = new Map<string, { covered: number; total: number }>();
    for (const s of sessions) {
      const code = s.lesson_plans.faculty.departments.code;
      const entry = byDept.get(code) ?? { covered: 0, total: 0 };
      entry.total += 1;
      if (s.is_covered) entry.covered += 1;
      byDept.set(code, entry);
    }

    return Array.from(byDept.entries())
      .filter(([, v]) => v.total > 0)
      .map(([code, v]) => ({
        code,
        percentage: Math.round((v.covered / v.total) * 1000) / 10,
      }))
      .filter((d) => d.percentage < COMPLETION_THRESHOLD_PERCENT)
      .map((d) => ({
        type: 'course_completion' as const,
        title: `Course completion behind in ${d.code}`,
        description: `${d.percentage}% of planned sessions covered so far`,
      }));
  }

  private async attentionFlags() {
    const [deptAttendance, fees, workload, courseCompletion] =
      await Promise.all([
        this.departmentAttendanceFlags(),
        this.feesOutstandingFlag(),
        this.facultyWorkloadFlags(),
        this.courseCompletionFlags(),
      ]);

    return [...deptAttendance, fees, workload, ...courseCompletion].filter(
      (f): f is NonNullable<typeof f> => f != null,
    );
  }
}
