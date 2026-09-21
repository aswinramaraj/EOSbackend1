import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { Prisma } from '../../../../generated/prisma/client';
import { WORKLOAD_THRESHOLD_HOURS } from 'src/common/constants/workload.constant';
import { TtlCache } from 'src/common/utils/ttl-cache.util';

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

  // Institution-wide (no department/tenant scoping needed, so a plain
  // single-value TtlCache is safe here — see PERFORMANCE_CACHE_STRATEGY.md).
  // 60s matches the existing feesOutstandingCache/overviewCache convention
  // in this same file/module.
  private readonly departmentAttendanceFlagsCache = new TtlCache<
    { type: 'attendance'; title: string; description: string }[]
  >(60_000);
  private readonly facultyWorkloadFlagsCache = new TtlCache<{
    type: 'workload';
    title: string;
    description: string;
  } | null>(60_000);
  private readonly courseCompletionFlagsCache = new TtlCache<
    { type: 'course_completion'; title: string; description: string }[]
  >(60_000);

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

    // Was: fetch every attendance_records row for the whole period into Node
    // and aggregate in JS — self-flagged in a prior review as "fine at
    // current data volume, but would want a DB-side GROUP BY if attendance
    // history grows into the millions of rows" (docs/production/DATABASE_AUDIT.md
    // §3). Pushed into one grouped SQL query instead — same result, no
    // unbounded row fetch regardless of how large the period's attendance
    // history gets.
    const [
      studentsTotalActive,
      newAdmissions,
      facultyTotalActive,
      newHires,
      nonTeachingStaffTotalActive,
      departmentsTotal,
      [attendanceSummary],
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
      this.prisma.$queryRaw<
        {
          total: bigint;
          present: bigint;
          students_below_threshold: bigint;
          best_month_key: string | null;
        }[]
      >(Prisma.sql`
        WITH period_attendance AS (
          SELECT student_id, status, attendance_date
          FROM attendance_records
          WHERE attendance_date BETWEEN ${start} AND ${end}
        ),
        student_pct AS (
          SELECT student_id,
            (COUNT(*) FILTER (WHERE status = 'present')::numeric / COUNT(*) * 100) AS pct
          FROM period_attendance
          GROUP BY student_id
        ),
        month_pct AS (
          SELECT to_char(attendance_date, 'YYYY-MM') AS month_key,
            (COUNT(*) FILTER (WHERE status = 'present')::numeric / COUNT(*) * 100) AS pct
          FROM period_attendance
          GROUP BY month_key
        )
        SELECT
          (SELECT COUNT(*) FROM period_attendance)::bigint AS total,
          (SELECT COUNT(*) FILTER (WHERE status = 'present') FROM period_attendance)::bigint AS present,
          (SELECT COUNT(*) FROM student_pct WHERE pct < 75)::bigint AS students_below_threshold,
          (SELECT month_key FROM month_pct ORDER BY pct DESC LIMIT 1) AS best_month_key
      `),
    ]);

    const total = Number(attendanceSummary?.total ?? 0);
    const present = Number(attendanceSummary?.present ?? 0);
    const meanPercentage =
      total > 0 ? Math.round((present / total) * 1000) / 10 : null;
    const studentsBelowThreshold = Number(
      attendanceSummary?.students_below_threshold ?? 0,
    );
    const bestMonthKey = attendanceSummary?.best_month_key ?? null;
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
    const [placement, attentionFlags, campus, employee] = await Promise.all([
      this.placementSummary(),
      this.attentionFlags(),
      this.campusInfrastructure(),
      this.employeeSnapshot(),
    ]);
    return { placement, attention_flags: attentionFlags, campus, employee };
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

  /**
   * `drive_type` is real once internship_drive_type.query.md runs — the
   * raw query returns no rows (no filtering) until then, so this
   * full-time-placement summary is unaffected either way.
   */
  private async internshipDriveIds(): Promise<Set<number>> {
    try {
      const rows = await this.prisma.$queryRaw<{ id: number }[]>`
        SELECT id FROM placement_drives WHERE drive_type = 'internship'
      `;
      return new Set(rows.map((r) => r.id));
    } catch {
      return new Set();
    }
  }

  private async placementSummary() {
    const today = startOfToday();
    const weekFromNow = new Date(today);
    weekFromNow.setDate(weekFromNow.getDate() + 7);

    const [allDrives, allApplications, registeredStudentIds, internshipIds] =
      await Promise.all([
        this.prisma.placement_drives.findMany({
          select: {
            id: true,
            company_id: true,
            status: true,
            scheduled_date: true,
          },
        }),
        this.prisma.student_drive_applications.findMany({
          select: { drive_id: true, status: true, offered_package: true },
        }),
        this.prisma.student_drive_applications.findMany({
          select: { student_id: true },
          distinct: ['student_id'],
        }),
        this.internshipDriveIds(),
      ]);
    // Full-time-placement summary — excludes internship drives (see
    // internship_drive_type.query.md; Internships get their own view).
    const drives = allDrives.filter((d) => !internshipIds.has(d.id));
    const applications = allApplications.filter(
      (a) => !internshipIds.has(a.drive_id),
    );

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

  /**
   * Department attendance below ATTENDANCE_THRESHOLD_PERCENT (75%, this
   * codebase's existing student-attendance condonation threshold), over the
   * last 7 days. Was: fetch every attendance_records row for the last 7 days
   * institution-wide and aggregate per-department in JS
   * (docs/production/PERFORMANCE_AUDIT.md §3) — now a single grouped SQL
   * query, one row per department instead of one row per attendance record.
   */
  private async departmentAttendanceFlags() {
    return this.departmentAttendanceFlagsCache.get(async () => {
      const ATTENDANCE_THRESHOLD_PERCENT = 75;
      const today = startOfToday();
      const sevenDaysAgo = new Date(today);
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);

      const rows = await this.prisma.$queryRaw<
        { code: string; name: string; present: bigint; total: bigint }[]
      >(Prisma.sql`
        SELECT d.code, d.name,
          COUNT(*) FILTER (WHERE ar.status = 'present')::bigint AS present,
          COUNT(*)::bigint AS total
        FROM attendance_records ar
        JOIN classes cl ON cl.id = ar.class_id
        JOIN departments d ON d.id = cl.department_id
        WHERE ar.attendance_date BETWEEN ${sevenDaysAgo} AND ${today}
        GROUP BY d.code, d.name
      `);

      return rows
        .map((v) => ({
          code: v.code,
          name: v.name,
          percentage:
            Math.round((Number(v.present) / Number(v.total)) * 1000) / 10,
        }))
        .filter((d) => d.percentage < ATTENDANCE_THRESHOLD_PERCENT)
        .sort((a, b) => a.percentage - b.percentage)
        .map((d) => ({
          type: 'attendance' as const,
          title: `${d.code} attendance at ${d.percentage}%`,
          description: `Below the ${ATTENDANCE_THRESHOLD_PERCENT}% threshold over the last 7 days`,
        }));
    });
  }

  // 60s TTL — this aggregate is hit by both the dashboard insights and the
  // student-list summary, often within the same short window (e.g. a
  // principal opening both tabs); a value up to a minute stale is normal for
  // a fee-outstanding summary tile, not a correctness issue.
  private readonly feesOutstandingCache = new TtlCache<{
    totalOutstanding: number;
    studentsWithOutstanding: number;
  }>(60_000);

  /**
   * Institution-wide fee demand vs collected, computed as one SQL aggregate
   * rather than fetching every student_fee_demand_mapping + fee_payments row
   * and summing in JS (the previous approach here, and independently
   * duplicated in PrincipalStudentsService.feesOutstanding() — both now call
   * this one method instead). Semantics preserved exactly: outstanding is
   * computed per demand-mapping row (not netted across a student's other
   * mappings), summed/counted only over mappings where it's positive.
   */
  async computeFeesOutstanding(): Promise<{
    totalOutstanding: number;
    studentsWithOutstanding: number;
  }> {
    return this.feesOutstandingCache.get(() => this.queryFeesOutstanding());
  }

  private async queryFeesOutstanding(): Promise<{
    totalOutstanding: number;
    studentsWithOutstanding: number;
  }> {
    const [row] = await this.prisma.$queryRaw<
      { total_outstanding: string | null; students_with_outstanding: bigint }[]
    >`
      WITH mapping_outstanding AS (
        SELECT
          d.student_id,
          d.total_amount - COALESCE(p.paid, 0) AS outstanding
        FROM student_fee_demand_mapping d
        LEFT JOIN (
          SELECT student_fee_demand_mapping_id, SUM(amount_paid) AS paid
          FROM fee_payments
          GROUP BY student_fee_demand_mapping_id
        ) p ON p.student_fee_demand_mapping_id = d.id
      )
      SELECT
        COALESCE(SUM(outstanding) FILTER (WHERE outstanding > 0), 0) AS total_outstanding,
        COUNT(DISTINCT student_id) FILTER (WHERE outstanding > 0) AS students_with_outstanding
      FROM mapping_outstanding
    `;

    return {
      totalOutstanding: Number(row?.total_outstanding ?? 0),
      studentsWithOutstanding: Number(row?.students_with_outstanding ?? 0n),
    };
  }

  /** Institution-wide fee demand vs collected, from real student_fee_demand_mapping + fee_payments rows. */
  private async feesOutstandingFlag() {
    const { totalOutstanding, studentsWithOutstanding } =
      await this.computeFeesOutstanding();

    if (totalOutstanding <= 0) return null;

    const crores = Math.round((totalOutstanding / 1e7) * 100) / 100;
    return {
      type: 'fees' as const,
      title:
        crores >= 1
          ? `₹${crores} Cr fees outstanding`
          : `₹${Math.round(totalOutstanding).toLocaleString('en-IN')} fees outstanding`,
      description: `${studentsWithOutstanding.toLocaleString('en-IN')} students with an unpaid balance`,
    };
  }

  /** Faculty with a scheduled weekly teaching load above WORKLOAD_THRESHOLD_HOURS, from real timetable_slots durations. */
  /**
   * Was: fetch every timetable_slots row institution-wide (unbounded, no
   * filter at all) and sum per-faculty hours in JS — same class of issue as
   * departmentAttendanceFlags/courseCompletionFlags above, found while
   * fixing those (docs/production/DATABASE_AUDIT.md §5 lists this alongside
   * them as a caching/aggregation candidate). Now a single grouped SQL query.
   */
  private async facultyWorkloadFlags() {
    return this.facultyWorkloadFlagsCache.get(async () => {
      const [summary] = await this.prisma.$queryRaw<
        { overloaded_count: bigint; dept_codes: string[] | null }[]
      >(Prisma.sql`
        WITH per_faculty AS (
          SELECT ts.faculty_id, d.code,
            SUM(EXTRACT(EPOCH FROM (ts.end_time - ts.start_time)) / 3600.0) AS hours
          FROM timetable_slots ts
          JOIN faculty f ON f.id = ts.faculty_id
          JOIN departments d ON d.id = f.department_id
          GROUP BY ts.faculty_id, d.code
        )
        SELECT COUNT(*)::bigint AS overloaded_count,
          ARRAY_AGG(DISTINCT code ORDER BY code) AS dept_codes
        FROM per_faculty
        WHERE hours > ${WORKLOAD_THRESHOLD_HOURS}
      `);

      const overloadedCount = Number(summary?.overloaded_count ?? 0);
      if (overloadedCount === 0) return null;

      const deptCodes = summary?.dept_codes ?? [];
      return {
        type: 'workload' as const,
        title: `Faculty workload above ${WORKLOAD_THRESHOLD_HOURS} hrs`,
        description: `${overloadedCount} faculty across ${deptCodes.join(', ')}`,
      };
    });
  }

  /**
   * Department course-completion rate below COMPLETION_THRESHOLD_PERCENT,
   * from real lesson_plan_sessions.is_covered rows. Was: fetch every
   * lesson_plan_sessions row institution-wide with no date/semester filter
   * at all — the most severe of the 3 unbounded-findMany findings in
   * docs/production/PERFORMANCE_AUDIT.md §3 ("grows unboundedly release over
   * release"). Now a single grouped SQL query, one row per department.
   * Note: this still has no semester/date bound (same behavior as before —
   * all-time completion rate) — deliberately not changed here, since scoping
   * this to "current semester" is a product-semantics decision (which
   * semester counts as "current" can differ per department/batch), not a
   * pure performance fix. Flagging as a follow-up, not silently deciding it.
   */
  private async courseCompletionFlags() {
    const COMPLETION_THRESHOLD_PERCENT = 60;

    return this.courseCompletionFlagsCache.get(async () => {
      const rows = await this.prisma.$queryRaw<
        { code: string; covered: bigint; total: bigint }[]
      >(Prisma.sql`
        SELECT d.code,
          COUNT(*) FILTER (WHERE lps.is_covered)::bigint AS covered,
          COUNT(*)::bigint AS total
        FROM lesson_plan_sessions lps
        JOIN lesson_plans lp ON lp.id = lps.lesson_plan_id
        JOIN faculty f ON f.id = lp.faculty_id
        JOIN departments d ON d.id = f.department_id
        GROUP BY d.code
      `);

      return rows
        .map((v) => ({
          code: v.code,
          percentage:
            Math.round((Number(v.covered) / Number(v.total)) * 1000) / 10,
        }))
        .filter((d) => d.percentage < COMPLETION_THRESHOLD_PERCENT)
        .map((d) => ({
          type: 'course_completion' as const,
          title: `Course completion behind in ${d.code}`,
          description: `${d.percentage}% of planned sessions covered so far`,
        }));
    });
  }

  /**
   * Employee-category snapshot (attendance/leave/appraisals) — the same
   * grouping HoD's and Secretary's sidebar "Employee" nav section already
   * uses, condensed into one institution-wide dashboard card instead of a
   * full set of new pages. `pending_appraisals` mirrors HrDashboardService's
   * own institution-wide count (appraisal_requests awaiting HR action, past
   * HoD review) so this figure matches what HR Payroll's own dashboard shows.
   */
  private async employeeSnapshot() {
    const today = startOfToday();

    const [facultyTotalActive, facultyDailyRows, pendingAppraisals] =
      await Promise.all([
        this.prisma.faculty.count({ where: { status: 'active' } }),
        this.prisma.faculty_daily_attendance.findMany({
          where: { attendance_date: today },
          select: { status: true },
        }),
        this.prisma.appraisal_requests.count({
          where: { status: { in: ['hod_reviewed', 'hr_scored'] } },
        }),
      ]);

    const reportedToday = facultyDailyRows.filter((r) =>
      ['full_day', 'half_day', 'on_duty'].includes(r.status),
    ).length;
    const onLeaveToday = facultyDailyRows.filter(
      (r) => r.status === 'on_leave',
    ).length;

    return {
      total_active: facultyTotalActive,
      attendance_marked_today: facultyDailyRows.length > 0,
      attendance_percentage_today:
        facultyDailyRows.length > 0
          ? Math.round((reportedToday / facultyDailyRows.length) * 1000) / 10
          : null,
      on_leave_today: onLeaveToday,
      pending_appraisals: pendingAppraisals,
    };
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
