import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { PrincipalDashboardService } from '../dashboard/dashboard.service';
import { ListPrincipalStudentsQueryDto } from './dto/list-principal-students-query.dto';

const ATTENDANCE_THRESHOLD_PERCENT = 75;

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
   * "Mean CGPA" and "students with arrears" from the reference design are
   * deliberately not included: no table stores or lets us honestly derive
   * either (see PrincipalExamsService's own doc comment on why a composite
   * CGPA can't be recovered from exam_marks, and
   * PrincipalDashboardService.insights()'s comment on why an arrears figure
   * can't be computed correctly). The frontend renders "—" for both rather
   * than a guess.
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

  private async feesOutstanding() {
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

    return {
      students_pending: studentsWithOutstanding.size,
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
    >['where'] = {
      status: 'active',
    };
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

    const rows = await this.prisma.students.findMany({
      where,
      orderBy: { id: 'desc' },
      select: {
        id: true,
        student_id_no: true,
        roll_no: true,
        register_no: true,
        batches: { select: { id: true, name: true } },
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
      },
    });

    const ids = rows.map((r) => r.id);
    const [attendanceByStudent, feeByStudent, placementByStudent] =
      await Promise.all([
        this.attendanceByStudent(ids),
        this.feesByStudent(ids),
        this.placementByStudent(ids),
      ]);

    let students = rows.map((row) => {
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
        batch: row.batches,
        department,
        section: row.classes?.section ?? null,
        semester: row.classes?.current_semester ?? null,
        attendance_percentage: attendanceByStudent.get(row.id) ?? null,
        fees_status: feeByStudent.get(row.id) ?? 'not_billed',
        placement_status: placementByStudent.get(row.id) ?? 'not_registered',
      };
    });

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
    }

    return { total: students.length, students };
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
}
