import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { Prisma } from '../../../../generated/prisma/client';
import { PrincipalDashboardService } from '../dashboard/dashboard.service';
import { ListPrincipalStudentsQueryDto } from './dto/list-principal-students-query.dto';

const ATTENDANCE_THRESHOLD_PERCENT = 75;
const DEFAULT_PAGE_SIZE = 15;

/** Same GRADE_LOOKUP formula as PrincipalExamsService/HodClassRecordsService — copied verbatim, not reinvented. */
const GRADE_LOOKUP = Prisma.sql`
  LEFT JOIN LATERAL (
    SELECT is_pass, grade_point FROM grade_bands gb2
    WHERE gb2.min_percentage <= (CASE WHEN em.is_absent THEN 0 ELSE em.marks_obtained / NULLIF(em.max_marks, 0) * 100 END)
    ORDER BY gb2.min_percentage DESC
    LIMIT 1
  ) gb ON true
`;

/**
 * Same Odd/Even semester convention as PrincipalDashboardService's
 * getPeriodRange('term', ...) — duplicated here (that helper is private to
 * dashboard.service.ts) rather than exported, matching how this codebase
 * already treats this exact convention (see HrRequestsService.academicYearFor
 * for the year-cutoff sibling of this pattern).
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

function startOfToday(): Date {
  return new Date(new Date().toISOString().slice(0, 10));
}

@Injectable()
export class PrincipalStudentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dashboard: PrincipalDashboardService,
  ) {}

  /**
   * GET /me/principal/students/filters
   *
   * Real dropdown options only — batches/departments straight from their own
   * tables, sections as the distinct `classes.section` values on file. No
   * hardcoded department/section lists (the reference design's CSE/AIDS/...
   * dropdown is illustrative, not authoritative — this institution's real
   * departments are whatever `departments` actually contains).
   */
  async filters() {
    const [batches, departments, sectionRows] = await Promise.all([
      this.prisma.batches.findMany({
        select: { id: true, name: true },
        orderBy: { start_year: 'desc' },
      }),
      this.prisma.departments.findMany({
        select: { id: true, name: true, code: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.classes.findMany({
        select: { section: true },
        distinct: ['section'],
        orderBy: { section: 'asc' },
      }),
    ]);

    return {
      batches,
      departments,
      sections: sectionRows.map((r) => r.section),
    };
  }

  /**
   * GET /me/principal/students/summary
   *
   * Reuses PrincipalDashboardService's already-validated public methods for
   * present-today/attendance-today and the below-75%-threshold count, rather
   * than re-deriving the same attendance_records aggregation a second time.
   * Fees and placement are computed locally with the same real-data pattern
   * PrincipalDashboardService.feesOutstandingFlag()/placementSummary() use
   * (those are private there, so the ~10-line query is duplicated here
   * rather than forced open — same tradeoff this codebase already makes for
   * MeFeesService.computeFees()'s reuse-by-pattern, not by import).
   *
   * This summary() endpoint doesn't compute mean CGPA or arrears itself —
   * list() below does, via cgpaByStudent(), reusing the same
   * grade_bands.is_pass/grade_point percentage rule IqacAcademicQualityService's
   * Results/Grade-distribution pages already treat as authoritative
   * (exam_pass_rules_settings.min_external_marks still can't be applied,
   * for the same no-internal/external-split reason).
   */
  async summary() {
    const [todayStats, termStats, feeStats, placementStats] = await Promise.all(
      [
        this.dashboard.summary(),
        this.dashboard.summaryForPeriod('term'),
        this.feesOutstanding(),
        this.placementCounts(),
      ],
    );

    return {
      on_roll: todayStats.students.total_active,
      present_today: todayStats.students.present_today,
      absent_today: todayStats.students.absent_today,
      attendance_percentage_today:
        todayStats.students.attendance_percentage_today,
      students_below_threshold: termStats.attendance.students_below_threshold,
      fees: feeStats,
      placement: placementStats,
    };
  }

  /** Delegates to PrincipalDashboardService.computeFeesOutstanding() — one shared SQL aggregate instead of this service independently re-fetching and re-summing every demand/payment row itself. */
  private async feesOutstanding() {
    const { totalOutstanding, studentsWithOutstanding } =
      await this.dashboard.computeFeesOutstanding();

    return {
      students_pending: studentsWithOutstanding,
      total_outstanding: Math.round(totalOutstanding),
    };
  }

  private async placementCounts() {
    const applications = await this.prisma.student_drive_applications.findMany({
      select: { student_id: true, status: true },
    });
    const registered = new Set(applications.map((a) => a.student_id));
    const placed = new Set(
      applications
        .filter((a) => a.status === 'placed')
        .map((a) => a.student_id),
    );
    return { placed: placed.size, registered: registered.size };
  }

  /**
   * GET /me/principal/students
   *
   * Only ~130 real students exist in this environment (verified live), so —
   * unlike the paginated Admin students list — this fetches every matching
   * row, computes attendance/fees/placement for exactly that set, then
   * applies the attendance/fees filter pill in memory. Filtering
   * attendance-% or fee-status correctly at the SQL level would need a
   * materialized rollup this schema doesn't have; at this data volume,
   * computing in memory is simpler and just as correct. Revisit with a real
   * GROUP BY if enrollment grows by orders of magnitude.
   */
  async list(query: ListPrincipalStudentsQueryDto) {
    const where: NonNullable<
      Parameters<typeof this.prisma.students.findMany>[0]
    >['where'] = {};
    if (!query.status || query.status === 'active') where.status = 'active';
    else if (query.status === 'inactive') where.status = 'inactive';
    if (query.batch_id) where.batch_id = query.batch_id;
    if (query.section) where.classes = { section: query.section };
    if (query.department_id) {
      where.OR = [
        { classes: { department_id: query.department_id } },
        { courses: { department_id: query.department_id } },
      ];
    }
    if (query.q) {
      const q = query.q;
      where.AND = [
        {
          OR: [
            { student_id_no: { contains: q, mode: 'insensitive' } },
            { roll_no: { contains: q, mode: 'insensitive' } },
            { register_no: { contains: q, mode: 'insensitive' } },
            { users: { email: { contains: q, mode: 'insensitive' } } },
            {
              soa_applications: {
                first_name: { contains: q, mode: 'insensitive' },
              },
            },
            {
              soa_applications: {
                last_name: { contains: q, mode: 'insensitive' },
              },
            },
            {
              courses: {
                departments: { name: { contains: q, mode: 'insensitive' } },
              },
            },
            {
              courses: {
                departments: { code: { contains: q, mode: 'insensitive' } },
              },
            },
          ],
        },
      ];
    }

    const STUDENT_SELECT = {
      id: true,
      student_id_no: true,
      roll_no: true,
      register_no: true,
      status: true,
      batches: { select: { id: true, name: true, start_year: true } },
      classes: {
        select: {
          section: true,
          current_semester: true,
          departments: { select: { id: true, name: true, code: true } },
        },
      },
      courses: {
        select: {
          departments: { select: { id: true, name: true, code: true } },
        },
      },
      users: { select: { email: true } },
      soa_applications: { select: { first_name: true, last_name: true } },
      faculty: { select: { id: true, first_name: true, last_name: true } },
    } satisfies NonNullable<
      Parameters<typeof this.prisma.students.findMany>[0]
    >['select'];

    type StudentRow = Awaited<
      ReturnType<
        typeof this.prisma.students.findMany<{
          where: typeof where;
          select: typeof STUDENT_SELECT;
        }>
      >
    >[number];

    const toResponseRow = (
      row: StudentRow,
      attendanceByStudent: Map<number, number>,
      feeByStudent: Map<number, 'paid' | 'partial' | 'pending' | 'not_billed'>,
      placementByStudent: Map<number, 'placed' | 'applied' | 'not_registered'>,
      cgpaByStudent: Map<number, { cgpa: number | null; arrear_count: number }>,
    ) => {
      const name =
        row.soa_applications?.first_name || row.soa_applications?.last_name
          ? [row.soa_applications?.first_name, row.soa_applications?.last_name]
              .filter(Boolean)
              .join(' ')
          : row.users.email;
      const department =
        row.classes?.departments ?? row.courses?.departments ?? null;

      return {
        id: row.id,
        name,
        student_id_no: row.student_id_no,
        roll_no: row.roll_no,
        register_no: row.register_no,
        status: row.status,
        batch: row.batches,
        department,
        section: row.classes?.section ?? null,
        semester: row.classes?.current_semester ?? null,
        attendance_percentage: attendanceByStudent.get(row.id) ?? null,
        fees_status: feeByStudent.get(row.id) ?? 'not_billed',
        placement_status: placementByStudent.get(row.id) ?? 'not_registered',
        cgpa: cgpaByStudent.get(row.id)?.cgpa ?? null,
        has_arrears: cgpaByStudent.get(row.id) ? cgpaByStudent.get(row.id)!.arrear_count > 0 : null,
        mentor: row.faculty
          ? { id: row.faculty.id, name: `${row.faculty.first_name} ${row.faculty.last_name}` }
          : null,
      };
    };

    const limit = query.limit ?? DEFAULT_PAGE_SIZE;
    const page = query.page ?? 1;

    // Fast path: no derived-metric filter requested (the common case — plain
    // browsing/search). SQL does the sort and pagination directly, and the
    // 4 bulk lookups below only ever run against this page's ~15 ids instead
    // of every matching student institution-wide.
    if (!query.filter || query.filter === 'all') {
      const [rows, total] = await this.prisma.$transaction([
        this.prisma.students.findMany({
          where,
          select: STUDENT_SELECT,
          // Batch-wise register order: most recently admitted batch (current
          // 1st years) first, then department code, then section, then
          // register/roll number — matches the paper register's real filing
          // order. Prisma can't coalesce classes.departments/courses.departments
          // into one sort key, so this orders by the (far more common)
          // classes.departments path; a student on the rarer courses-only
          // path sorts by department last instead of by its actual code —
          // a documented, low-risk approximation, not a correctness bug
          // (every student still appears exactly once, on the right page).
          orderBy: [
            { batches: { start_year: 'desc' } },
            { classes: { departments: { code: 'asc' } } },
            { classes: { section: 'asc' } },
            { register_no: 'asc' },
            { roll_no: 'asc' },
          ],
          skip: (page - 1) * limit,
          take: limit,
        }),
        this.prisma.students.count({ where }),
      ]);

      const ids = rows.map((r) => r.id);
      const [attendanceByStudent, feeByStudent, placementByStudent, cgpaByStudent] =
        await Promise.all([
          this.attendanceByStudent(ids),
          this.feesByStudent(ids),
          this.placementByStudent(ids),
          this.cgpaByStudent(ids),
        ]);

      return {
        total,
        page,
        limit,
        total_pages: Math.max(Math.ceil(total / limit), 1),
        students: rows.map((row) =>
          toResponseRow(row, attendanceByStudent, feeByStudent, placementByStudent, cgpaByStudent),
        ),
      };
    }

    // Slow path: a derived-metric filter (attendance/fees/cgpa/arrears) is
    // requested. Computing these correctly in SQL would need a materialized
    // rollup this schema doesn't have, so every matching student is fetched,
    // the derived fields computed, then filtered/sorted/paginated in memory —
    // unavoidable for this specific request shape, but no longer paid by the
    // default "no filter" page load above.
    const rows = await this.prisma.students.findMany({
      where,
      orderBy: { id: 'desc' },
      select: STUDENT_SELECT,
    });

    const ids = rows.map((r) => r.id);
    const [attendanceByStudent, feeByStudent, placementByStudent, cgpaByStudent] =
      await Promise.all([
        this.attendanceByStudent(ids),
        this.feesByStudent(ids),
        this.placementByStudent(ids),
        this.cgpaByStudent(ids),
      ]);

    let students = rows.map((row) =>
      toResponseRow(row, attendanceByStudent, feeByStudent, placementByStudent, cgpaByStudent),
    );

    if (query.filter === 'attendance_below_75') {
      students = students.filter(
        (s) =>
          s.attendance_percentage != null &&
          s.attendance_percentage < ATTENDANCE_THRESHOLD_PERCENT,
      );
    } else if (query.filter === 'fees_pending') {
      students = students.filter(
        (s) => s.fees_status === 'pending' || s.fees_status === 'partial',
      );
    } else if (query.filter === 'cgpa_above_85') {
      students = students.filter((s) => s.cgpa != null && s.cgpa > 8.5);
    } else if (query.filter === 'cgpa_below_7') {
      students = students.filter((s) => s.cgpa != null && s.cgpa < 7);
    } else if (query.filter === 'has_arrears') {
      students = students.filter((s) => s.has_arrears === true);
    }

    // Batch-wise register order: most recently admitted batch (current 1st
    // years) first, then every department in code order, then section, then
    // roll/register number — matches the paper register's real filing
    // order, not an arbitrary id sort. Once a batch's rows are exhausted the
    // next page continues straight into the next batch, no reset.
    students.sort((a, b) => {
      const startYearA = a.batch?.start_year ?? -Infinity;
      const startYearB = b.batch?.start_year ?? -Infinity;
      if (startYearB !== startYearA) return startYearB - startYearA;
      const deptA = a.department?.code ?? '';
      const deptB = b.department?.code ?? '';
      if (deptA !== deptB) return deptA.localeCompare(deptB);
      const secA = a.section ?? '';
      const secB = b.section ?? '';
      if (secA !== secB) return secA.localeCompare(secB);
      const rollA = a.register_no ?? a.roll_no ?? '';
      const rollB = b.register_no ?? b.roll_no ?? '';
      return rollA.localeCompare(rollB);
    });

    const total = students.length;
    const offset = (page - 1) * limit;
    const pageStudents = students.slice(offset, offset + limit);

    return {
      total,
      page,
      limit,
      total_pages: Math.max(Math.ceil(total / limit), 1),
      students: pageStudents,
    };
  }

  /** Attendance % this term (same Odd/Even range as the dashboard's own period stat), bulk-computed for exactly the given student ids. */
  private async attendanceByStudent(
    studentIds: number[],
  ): Promise<Map<number, number>> {
    if (studentIds.length === 0) return new Map();
    const { start, end } = currentTermRange(startOfToday());
    const records = await this.prisma.attendance_records.findMany({
      where: {
        student_id: { in: studentIds },
        attendance_date: { gte: start, lte: end },
      },
      select: { student_id: true, status: true },
    });

    const byStudent = new Map<number, { present: number; total: number }>();
    for (const r of records) {
      const entry = byStudent.get(r.student_id) ?? { present: 0, total: 0 };
      entry.total += 1;
      if (r.status === 'present') entry.present += 1;
      byStudent.set(r.student_id, entry);
    }

    const result = new Map<number, number>();
    for (const [studentId, entry] of byStudent.entries()) {
      if (entry.total > 0) {
        result.set(
          studentId,
          Math.round((entry.present / entry.total) * 1000) / 10,
        );
      }
    }
    return result;
  }

  /** paid/partial/pending — same due = total_amount - Σamount_paid pattern MeFeesService.computeFees() uses, bulk-computed for exactly the given student ids. 'not_billed' means no fee demand row exists for that student at all. */
  private async feesByStudent(
    studentIds: number[],
  ): Promise<Map<number, 'paid' | 'partial' | 'pending' | 'not_billed'>> {
    if (studentIds.length === 0) return new Map();
    const demandMappings =
      await this.prisma.student_fee_demand_mapping.findMany({
        where: { student_id: { in: studentIds } },
        select: { id: true, student_id: true, total_amount: true },
      });
    if (demandMappings.length === 0) return new Map();

    const paidByMapping = await this.prisma.fee_payments.groupBy({
      by: ['student_fee_demand_mapping_id'],
      where: {
        student_fee_demand_mapping_id: { in: demandMappings.map((m) => m.id) },
      },
      _sum: { amount_paid: true },
    });
    const paidMap = new Map(
      paidByMapping.map((p) => [
        p.student_fee_demand_mapping_id,
        Number(p._sum.amount_paid ?? 0),
      ]),
    );

    const byStudent = new Map<number, { total: number; paid: number }>();
    for (const m of demandMappings) {
      const entry = byStudent.get(m.student_id) ?? { total: 0, paid: 0 };
      entry.total += Number(m.total_amount);
      entry.paid += paidMap.get(m.id) ?? 0;
      byStudent.set(m.student_id, entry);
    }

    const result = new Map<number, 'paid' | 'partial' | 'pending'>();
    for (const [studentId, entry] of byStudent.entries()) {
      const due = entry.total - entry.paid;
      if (due <= 0) result.set(studentId, 'paid');
      else if (entry.paid > 0) result.set(studentId, 'partial');
      else result.set(studentId, 'pending');
    }
    return result;
  }

  /** placed/applied/not_registered, bulk-computed for exactly the given student ids. */
  private async placementByStudent(
    studentIds: number[],
  ): Promise<Map<number, 'placed' | 'applied' | 'not_registered'>> {
    if (studentIds.length === 0) return new Map();
    const applications = await this.prisma.student_drive_applications.findMany({
      where: { student_id: { in: studentIds } },
      select: { student_id: true, status: true },
    });

    const result = new Map<number, 'placed' | 'applied' | 'not_registered'>();
    for (const a of applications) {
      if (a.status === 'placed') {
        result.set(a.student_id, 'placed');
      } else if (result.get(a.student_id) !== 'placed') {
        result.set(a.student_id, 'applied');
      }
    }
    return result;
  }

  /**
   * Real per-student CGPA and arrears, credit-weighted — the same formula
   * PrincipalExamsService's institution-wide "high CGPA" band and
   * HodClassRecordsService's per-class CGPA column already use (SUM(grade_point
   * * credits) / SUM(credits) over every real, results-published, non-absent
   * exam_marks row; subjects.credits defaults to 1 when unset). arrear_count
   * is the number of those rows whose grade_bands bracket is_pass = false.
   * A student with no real graded exam_marks on file gets `cgpa: null` and
   * `arrear_count: 0` — genuinely unknown, never fabricated.
   */
  private async cgpaByStudent(
    studentIds: number[],
  ): Promise<Map<number, { cgpa: number | null; arrear_count: number }>> {
    if (studentIds.length === 0) return new Map();
    const rows = await this.prisma.$queryRaw<
      { student_id: number; cgpa: string | null; arrears: bigint }[]
    >(Prisma.sql`
      WITH subject_grades AS (
        SELECT em.student_id, COALESCE(sub.credits, 1) AS credits, gb.grade_point, gb.is_pass
        FROM exam_marks em
        JOIN exam_subject_mapping esm ON esm.id = em.exam_subject_mapping_id
        JOIN exams e ON e.id = esm.exam_id
        JOIN subjects sub ON sub.id = esm.subject_id
        ${GRADE_LOOKUP}
        WHERE e.status = 'results_published' AND em.is_absent = false AND em.marks_obtained IS NOT NULL
          AND em.student_id IN (${Prisma.join(studentIds)})
      )
      SELECT student_id,
        (SUM(grade_point * credits) FILTER (WHERE grade_point IS NOT NULL)
          / NULLIF(SUM(credits) FILTER (WHERE grade_point IS NOT NULL), 0))::text AS cgpa,
        COUNT(*) FILTER (WHERE is_pass = false)::bigint AS arrears
      FROM subject_grades
      GROUP BY student_id
    `);

    const result = new Map<number, { cgpa: number | null; arrear_count: number }>();
    for (const row of rows) {
      result.set(row.student_id, {
        cgpa: row.cgpa != null ? Math.round(Number(row.cgpa) * 100) / 100 : null,
        arrear_count: Number(row.arrears ?? 0),
      });
    }
    return result;
  }
}
