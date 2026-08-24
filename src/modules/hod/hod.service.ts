import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { Prisma } from '../../../generated/prisma/client';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { FacultyAttendanceService } from '../faculty/faculty-attendance/faculty-attendance.service';
import { AnnouncementsService } from '../announcements/announcements/announcements.service';
import { HodSopPopService } from './hod-sop-pop.service';

/** Same threshold already used by PrincipalDashboardService/PrincipalStudentsService — reused, not reinvented. */
const ATTENDANCE_THRESHOLD_PERCENT = 75;

interface AttendanceTotalsRow {
  present: bigint;
  on_roll: bigint;
}
interface PctRow {
  pct: string | null;
}
interface CgpaRow {
  avg_cgpa: string | null;
}
interface PlacementRow {
  placed_count: bigint;
  highest_package: string | null;
  average_package: string | null;
}
interface ArrearsRow {
  students_with_arrears: bigint;
}

/**
 * Same Odd/Even semester convention as PrincipalDashboardService's private
 * getPeriodRange('term', ...), duplicated here rather than exported/shared —
 * matches how principal/students/students.service.ts already treats this
 * exact convention (see that file's own currentTermRange for the sibling copy).
 */
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

function formatHHMM(time: Date): string {
  return time.toISOString().slice(11, 16);
}

/** Copied verbatim from PrincipalExamsService's GRADE_LOOKUP — the one real credit-weighted grade-point formula in the codebase. */
const GRADE_LOOKUP = Prisma.sql`
  LEFT JOIN LATERAL (
    SELECT is_pass, grade_point FROM grade_bands gb2
    WHERE gb2.min_percentage <= (CASE WHEN em.is_absent THEN 0 ELSE em.marks_obtained / NULLIF(em.max_marks, 0) * 100 END)
    ORDER BY gb2.min_percentage DESC LIMIT 1
  ) gb ON true
`;

function cgpaCte(departmentId: number, semester?: number) {
  return Prisma.sql`
    WITH student_cgpa AS (
      SELECT em.student_id,
        (SUM(gb.grade_point * COALESCE(sub.credits, 1)) FILTER (WHERE gb.grade_point IS NOT NULL)
          / NULLIF(SUM(COALESCE(sub.credits, 1)) FILTER (WHERE gb.grade_point IS NOT NULL), 0)) AS cgpa
      FROM exam_marks em
      JOIN exam_subject_mapping esm ON esm.id = em.exam_subject_mapping_id
      JOIN exams e ON e.id = esm.exam_id
      JOIN subjects sub ON sub.id = esm.subject_id
      JOIN students st ON st.id = em.student_id
      JOIN classes cl ON cl.id = st.class_id
      ${GRADE_LOOKUP}
      WHERE e.status = 'results_published' AND em.is_absent = false AND em.marks_obtained IS NOT NULL
        AND cl.department_id = ${departmentId}
        ${semester !== undefined ? Prisma.sql`AND e.semester = ${semester}` : Prisma.empty}
      GROUP BY em.student_id
    )
    SELECT AVG(cgpa)::text AS avg_cgpa FROM student_cgpa
  `;
}

/**
 * GET /hod/dashboard?scope=today|term — every field below reads a real
 * table; nothing here is placeholder/fabricated data. Built from a 4-way
 * research pass cross-checked directly against prisma/schema.prisma:
 *  - student attendance: attendance_records, scoped via students->classes
 *  - faculty attendance: delegates to FacultyAttendanceService.getOverview
 *    (real punch/leave/OD precedence rules already live there)
 *  - CGPA/arrears: PrincipalExamsService's own credit-weighted grade
 *    formula, department-scoped instead of institution-wide
 *  - placements: same department-scoping pattern as
 *    PrincipalDepartmentsService, "eligible" defined the same way the real
 *    Placement dashboard already defines it (every department student —
 *    there is no stored eligibility flag anywhere)
 *  - pending approvals: faculty_leaves/faculty_od_requests
 *    (hod_approval_status) + the 3 real student-side HOD-approval queues
 *    (campus_outing_requests, student_leaves, od_request_hod_approvals)
 *  - up_next: timetable_slots for the HOD's own faculty_id (HODs often
 *    still teach)
 *  - announcements: delegates to AnnouncementsService.findAll — role 'hod'
 *    is a real, already-built audience/visibility branch there
 */
@Injectable()
export class HodService {
  private readonly logger = new Logger(HodService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly facultyAttendance: FacultyAttendanceService,
    private readonly announcements: AnnouncementsService,
    private readonly sopPop: HodSopPopService,
  ) {}

  async getDashboard(user: JwtPayload, scope: 'today' | 'term' = 'today') {
    const faculty = await this.prisma.faculty.findUnique({
      where: { user_id: user.sub },
      select: {
        id: true,
        first_name: true,
        last_name: true,
        designation: true,
        department_id: true,
      },
    });
    if (!faculty) {
      throw new NotFoundException({
        message: 'No faculty record found for this account.',
        errorCode: 'FACULTY_NOT_FOUND',
      });
    }
    const departmentId = faculty.department_id;

    try {
      const department = await this.prisma.departments.findUnique({
        where: { id: departmentId },
        select: { id: true, name: true, code: true },
      });
      if (!department) {
        throw new NotFoundException({
          message: 'Department not found.',
          errorCode: 'DEPARTMENT_NOT_FOUND',
        });
      }

      const dateFilter =
        scope === 'term'
          ? (() => {
              const { start, end } = currentTermRange(new Date());
              return Prisma.sql`ar.attendance_date BETWEEN ${start} AND ${end}`;
            })()
          : Prisma.sql`ar.attendance_date = CURRENT_DATE`;

      // Sequential, not Promise.all — same Supabase pooler-capacity
      // reasoning as principal-departments.service.ts's own comment; this
      // dashboard isn't latency-critical enough to risk tipping the pool.
      const [attendanceTotals] = await this.prisma.$queryRaw<
        AttendanceTotalsRow[]
      >(Prisma.sql`
        SELECT COUNT(*) FILTER (WHERE ar.status = 'present')::bigint AS present, COUNT(*)::bigint AS on_roll
        FROM attendance_records ar
        JOIN students st ON st.id = ar.student_id
        JOIN classes cl ON cl.id = st.class_id
        WHERE cl.department_id = ${departmentId} AND ${dateFilter}
      `);
      const present = Number(attendanceTotals?.present ?? 0);
      const onRoll = Number(attendanceTotals?.on_roll ?? 0);
      const attendancePercentage =
        onRoll > 0 ? Math.round((present / onRoll) * 1000) / 10 : 0;

      const studentCount = await this.prisma.students.count({
        where: { status: 'active', classes: { department_id: departmentId } },
      });
      const classCount = await this.prisma.classes.count({
        where: { department_id: departmentId },
      });

      const classPctRows = await this.prisma.$queryRaw<
        (PctRow & { class_id: number })[]
      >(Prisma.sql`
        SELECT cl.id AS class_id,
          (COUNT(*) FILTER (WHERE ar.status = 'present')::numeric / NULLIF(COUNT(*), 0) * 100)::text AS pct
        FROM attendance_records ar
        JOIN students st ON st.id = ar.student_id
        JOIN classes cl ON cl.id = st.class_id
        WHERE cl.department_id = ${departmentId} AND ${dateFilter}
        GROUP BY cl.id
      `);
      const classesAboveThreshold = classPctRows.filter(
        (r) => r.pct !== null && Number(r.pct) >= ATTENDANCE_THRESHOLD_PERCENT,
      ).length;

      const studentPctRows = await this.prisma.$queryRaw<
        (PctRow & { student_id: number })[]
      >(Prisma.sql`
        SELECT ar.student_id,
          (COUNT(*) FILTER (WHERE ar.status = 'present')::numeric / NULLIF(COUNT(*), 0) * 100)::text AS pct
        FROM attendance_records ar
        JOIN students st ON st.id = ar.student_id
        JOIN classes cl ON cl.id = st.class_id
        WHERE cl.department_id = ${departmentId} AND ${dateFilter}
        GROUP BY ar.student_id
      `);
      const belowThresholdStudentCount = studentPctRows.filter(
        (r) => r.pct !== null && Number(r.pct) < ATTENDANCE_THRESHOLD_PERCENT,
      ).length;

      // Faculty attendance — real punch/leave/OD precedence logic already
      // lives here; called wholesale rather than reimplemented. `today` is
      // always this call's own "today" stats regardless of `scope` — for
      // scope=term we override percentage/reported/on_leave/on_duty below
      // with a genuine term-range aggregate (this call is still needed for
      // `facultyOnRoll`, the active-headcount denominator either way).
      const facultyOverview =
        await this.facultyAttendance.getOverview(departmentId);
      const facultyOnRoll = facultyOverview.rows.length;
      let facultyAttendancePercentage =
        facultyOverview.today.attendance_percentage;
      let facultyReported = facultyOverview.rows.filter(
        (r) => r.today_status !== null,
      ).length;
      let facultyOnLeave = facultyOverview.today.on_leave;
      let facultyOnDuty = facultyOverview.today.on_duty;

      if (scope === 'term') {
        const { start: termStart, end: termEnd } = currentTermRange(new Date());
        // Simpler than "today"'s punch-vs-approved-leave precedence check
        // (that logic exists to gracefully handle a single not-yet-marked
        // day; over a whole term explicit faculty_daily_attendance rows are
        // the real record) — counts rows by status directly.
        const statusRows = await this.prisma.$queryRaw<
          { status: string; count: bigint }[]
        >(Prisma.sql`
          SELECT fda.status, COUNT(*)::bigint AS count
          FROM faculty_daily_attendance fda
          JOIN faculty f ON f.id = fda.faculty_id
          WHERE f.department_id = ${departmentId} AND f.status = 'active'
            AND fda.attendance_date BETWEEN ${termStart} AND ${termEnd}
          GROUP BY fda.status
        `);
        const countByStatus = new Map(
          statusRows.map((r) => [r.status, Number(r.count)]),
        );
        const full = countByStatus.get('full_day') ?? 0;
        const half = countByStatus.get('half_day') ?? 0;
        const absent = countByStatus.get('absent') ?? 0;
        const onLeave = countByStatus.get('on_leave') ?? 0;
        const denominator = full + half + absent + onLeave;
        facultyAttendancePercentage =
          denominator > 0
            ? Math.round(((full + half * 0.5) / denominator) * 100)
            : 0;
        facultyOnLeave = onLeave;
        facultyOnDuty = countByStatus.get('on_duty') ?? 0;

        const [reportedRow] = await this.prisma.$queryRaw<
          { reported: bigint }[]
        >(Prisma.sql`
          SELECT COUNT(DISTINCT fda.faculty_id)::bigint AS reported
          FROM faculty_daily_attendance fda
          JOIN faculty f ON f.id = fda.faculty_id
          WHERE f.department_id = ${departmentId} AND f.status = 'active'
            AND fda.attendance_date BETWEEN ${termStart} AND ${termEnd}
        `);
        facultyReported = Number(reportedRow?.reported ?? 0);
      }

      const [cgpaRow] = await this.prisma.$queryRaw<CgpaRow[]>(
        cgpaCte(departmentId),
      );
      const averageCgpaValue =
        cgpaRow?.avg_cgpa != null
          ? Math.round(Number(cgpaRow.avg_cgpa) * 100) / 100
          : null;

      // change vs previous semester — same formula, rerun per-semester and
      // diffed; no stored "previous CGPA" value exists anywhere to read instead.
      const recentSemesters = await this.prisma.$queryRaw<
        { semester: number }[]
      >(Prisma.sql`
        SELECT DISTINCT semester FROM exams WHERE status = 'results_published' ORDER BY semester DESC LIMIT 2
      `);
      let cgpaChange: number | null = null;
      if (recentSemesters.length === 2) {
        const [currentSem, previousSem] = recentSemesters.map(
          (r) => r.semester,
        );
        // Sequential — same pooler-capacity reasoning as every other query
        // in this file (Supabase's session-mode pool is capped at 15).
        const currentRow = await this.prisma.$queryRaw<CgpaRow[]>(
          cgpaCte(departmentId, currentSem),
        );
        const previousRow = await this.prisma.$queryRaw<CgpaRow[]>(
          cgpaCte(departmentId, previousSem),
        );
        const currentCgpa = currentRow[0]?.avg_cgpa;
        const previousCgpa = previousRow[0]?.avg_cgpa;
        if (currentCgpa != null && previousCgpa != null) {
          cgpaChange =
            Math.round((Number(currentCgpa) - Number(previousCgpa)) * 100) /
            100;
        }
      }

      // Placements — same department-scoping as
      // principal-departments.service.ts's placementRows. "eligible" =
      // every department student, matching the real Placement dashboard's
      // own precedent (drives.service.ts getPlacementStats) — there is no
      // stored placement-eligibility flag anywhere to filter on instead.
      const [placementRow] = await this.prisma.$queryRaw<PlacementRow[]>(
        Prisma.sql`
        WITH dept_students AS (
          SELECT st.id AS student_id FROM students st JOIN classes cl ON cl.id = st.class_id WHERE cl.department_id = ${departmentId}
        )
        SELECT
          COUNT(DISTINCT sda.student_id) FILTER (WHERE sda.status = 'placed')::bigint AS placed_count,
          MAX(sda.offered_package) FILTER (WHERE sda.status = 'placed')::text AS highest_package,
          AVG(sda.offered_package) FILTER (WHERE sda.status = 'placed')::text AS average_package
        FROM student_drive_applications sda JOIN dept_students ds ON ds.student_id = sda.student_id
      `,
      );
      const placedCount = Number(placementRow?.placed_count ?? 0);
      const eligibleCount = studentCount;

      // Arrears — same subject_attempts pattern as
      // PrincipalExamsService's deptArrearsRows, counting DISTINCT students
      // (not papers) to match "students affected" framing.
      const [arrearsRow] = await this.prisma.$queryRaw<ArrearsRow[]>(
        Prisma.sql`
        WITH subject_attempts AS (
          SELECT em.student_id, esm.subject_id, BOOL_OR(gb.is_pass) AS ever_passed
          FROM exam_marks em
          JOIN exam_subject_mapping esm ON esm.id = em.exam_subject_mapping_id
          JOIN exams e ON e.id = esm.exam_id
          JOIN students st ON st.id = em.student_id
          JOIN classes cl ON cl.id = st.class_id
          ${GRADE_LOOKUP}
          WHERE e.status = 'results_published' AND cl.department_id = ${departmentId}
          GROUP BY em.student_id, esm.subject_id
        )
        SELECT COUNT(DISTINCT student_id) FILTER (WHERE ever_passed IS NOT TRUE)::bigint AS students_with_arrears
        FROM subject_attempts
      `,
      );
      const arrearsCount = Number(arrearsRow?.students_with_arrears ?? 0);

      // Pending approvals — leaves/ODs department-scoped via the faculty
      // relation; the other 3 are the real student-side "awaiting HOD"
      // queues (campus outings, student leaves, OD-hod-approvals). Sequential,
      // not Promise.all — same pooler-capacity reasoning as every other
      // query in this file.
      const pendingLeaves = await this.prisma.faculty_leaves.count({
        where: {
          hod_approval_status: 'pending',
          faculty: { department_id: departmentId },
        },
      });
      const pendingOds = await this.prisma.faculty_od_requests.count({
        where: {
          hod_approval_status: 'pending',
          faculty: { department_id: departmentId },
        },
      });
      const pendingCampusOutings =
        await this.prisma.campus_outing_requests.count({
          where: {
            status: 'faculty_approved',
            students: { classes: { department_id: departmentId } },
          },
        });
      const pendingStudentLeaves = await this.prisma.student_leaves.count({
        where: {
          status: 'faculty_approved',
          students: { classes: { department_id: departmentId } },
        },
      });
      const pendingOdApprovals =
        await this.prisma.od_request_hod_approvals.count({
          where: { status: 'pending', department_id: departmentId },
        });
      const pendingRequestsCount =
        pendingCampusOutings + pendingStudentLeaves + pendingOdApprovals;

      // SOP/POP (service/purchase requests) awaiting this HoD's own review —
      // reuses the same real endpoint the SOP/POP Requests page itself calls,
      // so these counts can never drift from what that page shows.
      const sopPopRequests = await this.sopPop.getRequests(user);
      const pendingSopCount = sopPopRequests.sop.filter(
        (r) => r.status === 'awaiting_hod',
      ).length;
      const pendingPopCount = sopPopRequests.pop.filter(
        (r) => r.status === 'awaiting_hod',
      ).length;

      // Up next — the HOD's own remaining periods today (HODs often still
      // teach). Same table/joins as TimetableService.findTodayForFaculty;
      // written directly here (not via that shared method) only to add
      // subjects.subject_code, which its own select doesn't expose.
      const now = new Date();
      const dayOfWeek = now.getDay();
      const upNextRows = await this.prisma.timetable_slots.findMany({
        where: { faculty_id: faculty.id, day_of_week: dayOfWeek },
        orderBy: { period_number: 'asc' },
        select: {
          id: true,
          period_number: true,
          start_time: true,
          end_time: true,
          subjects: { select: { name: true, subject_code: true } },
          classes: { select: { section: true } },
        },
      });
      const nowHHMM = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      const upNext = upNextRows
        .map((row) => ({
          id: row.id,
          period_label: `Period ${row.period_number}`,
          subject_code: row.subjects.subject_code,
          subject_name: row.subjects.name,
          class_label: row.classes.section,
          start_time: formatHHMM(row.start_time),
          end_time: formatHHMM(row.end_time),
        }))
        .filter((slot) => slot.start_time >= nowHHMM);

      // Announcements — delegate to the real, already-built visibility
      // resolver (role 'hod' is a genuine audience branch there) rather
      // than a new query.
      const visibleAnnouncements = await this.announcements.findAll(user);
      const announcementsPreview = visibleAnnouncements
        .slice(0, 5)
        .map((a: Record<string, unknown>) => ({
          id: a.id as number,
          title: a.title as string,
          tag: (a.category as string | null) ?? 'General',
          posted_at: a.created_at as Date,
        }));

      // Needs-attention flags — every number below is one already computed
      // above; there's no separate "flags" table, so this list is derived
      // from real counts rather than fabricated copy.
      const flags: { type: string; title: string; detail: string }[] = [];
      if (belowThresholdStudentCount > 0) {
        flags.push({
          type: 'attendance',
          title: 'Students below attendance threshold',
          detail: `${belowThresholdStudentCount} student${belowThresholdStudentCount === 1 ? '' : 's'} below ${ATTENDANCE_THRESHOLD_PERCENT}% attendance`,
        });
      }
      if (pendingLeaves > 0) {
        flags.push({
          type: 'leave',
          title: 'Faculty leave requests pending',
          detail: `${pendingLeaves} awaiting your approval`,
        });
      }
      if (pendingOds > 0) {
        flags.push({
          type: 'od',
          title: 'Faculty OD requests pending',
          detail: `${pendingOds} awaiting your approval`,
        });
      }
      if (pendingRequestsCount > 0) {
        flags.push({
          type: 'request',
          title: 'Student requests pending',
          detail: `${pendingRequestsCount} awaiting your approval`,
        });
      }
      if (arrearsCount > 0) {
        flags.push({
          type: 'academic',
          title: 'Students with arrears',
          detail: `${arrearsCount} student${arrearsCount === 1 ? '' : 's'} have at least one arrear`,
        });
      }

      return {
        department: {
          id: department.id,
          name: department.name,
          code: department.code,
        },
        faculty: {
          id: faculty.id,
          name: `${faculty.first_name} ${faculty.last_name}`.trim(),
          designation: faculty.designation,
        },
        scope,
        student_attendance: {
          percentage: attendancePercentage,
          present,
          on_roll: onRoll,
          student_count: studentCount,
          class_count: classCount,
          classes_above_threshold: classesAboveThreshold,
          classes_above_threshold_total: classCount,
        },
        faculty_attendance: {
          percentage: facultyAttendancePercentage,
          reported: facultyReported,
          on_roll: facultyOnRoll,
          on_leave: facultyOnLeave,
          on_duty: facultyOnDuty,
        },
        average_cgpa: { value: averageCgpaValue, change: cgpaChange },
        placements: {
          placed_count: placedCount,
          eligible_count: eligibleCount,
          highest_package_lpa:
            placementRow?.highest_package != null
              ? Number(placementRow.highest_package)
              : null,
          average_package_lpa:
            placementRow?.average_package != null
              ? Math.round(Number(placementRow.average_package) * 100) / 100
              : null,
        },
        needs_attention: {
          flags,
          below_threshold_student_count: belowThresholdStudentCount,
          pending_requests_count: pendingRequestsCount,
          pending_leaves_count: pendingLeaves,
          pending_ods_count: pendingOds,
        },
        up_next: upNext,
        announcements: announcementsPreview,
        my_department: {
          name: department.name,
          code: department.code,
          class_count: classCount,
          student_count: studentCount,
          faculty_count: facultyOnRoll,
          attendance_percent: attendancePercentage,
          below_threshold_count: belowThresholdStudentCount,
          average_cgpa: averageCgpaValue,
          arrears_count: arrearsCount,
          placed_count: placedCount,
          eligible_count: eligibleCount,
          pending_requests_count: pendingRequestsCount,
          pending_sop_count: pendingSopCount,
          pending_pop_count: pendingPopCount,
        },
      };
    } catch (err) {
      if (err instanceof NotFoundException) throw err;
      this.logger.error('DB error computing HoD dashboard', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }
}
