import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { Prisma } from '../../../../generated/prisma/client';

/**
 * HR payroll reporting, built entirely from `salary_payments` (gross, net,
 * deductions, LOP, month/year, status) and `salary_divisions` (the per-faculty
 * component breakdown). No new tables — these are aggregations of what payroll
 * already records.
 *
 * An Indian financial year runs April–March, so every annual figure here is
 * bucketed on that boundary rather than the calendar year; a January payslip
 * belongs to the FY that started the previous April.
 *
 * salary_payment_status_enum is `processed | pending | hold` — there is no
 * 'paid'. "Processed" is what counts as money out of the door.
 */

/** April–March. FY 2026-27 covers 2026-04 .. 2027-03. */
function financialYearBounds(fy: number): {
  label: string;
  fromYear: number;
  fromMonth: number;
  toYear: number;
  toMonth: number;
} {
  return {
    label: `${fy}-${String((fy + 1) % 100).padStart(2, '0')}`,
    fromYear: fy,
    fromMonth: 4,
    toYear: fy + 1,
    toMonth: 3,
  };
}

/** The FY a given calendar month belongs to. */
export function financialYearOf(year: number, month: number): number {
  return month >= 4 ? year : year - 1;
}

function money(v: { toString(): string } | null | undefined): number {
  return v == null ? 0 : Number(v.toString());
}

interface MonthlyRow {
  year: number;
  month: number;
  headcount: bigint;
  gross: string | null;
  net: string | null;
  deductions: string | null;
  lop_days: string | null;
  paid_count: bigint;
  pending_count: bigint;
}

interface DepartmentRow {
  department_id: number | null;
  department_name: string | null;
  headcount: bigint;
  gross: string | null;
  net: string | null;
  deductions: string | null;
}

@Injectable()
export class HrReportsService {
  private readonly logger = new Logger(HrReportsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * GET /hr/reports/payroll-summary?year=
   *
   * Month-by-month payroll for a financial year, plus a department split. Both
   * are straight aggregates of salary_payments, so the figures reconcile with
   * the payslips themselves rather than being maintained separately.
   */
  async payrollSummary(fy?: number) {
    const year = fy ?? financialYearOf(new Date().getUTCFullYear(), new Date().getUTCMonth() + 1);
    const b = financialYearBounds(year);

    // (year > fromYear) OR (year = fromYear AND month >= 4) ... etc — expressed
    // as a single comparable integer so the range is one predicate.
    const fromKey = b.fromYear * 100 + b.fromMonth;
    const toKey = b.toYear * 100 + b.toMonth;

    try {
      const [monthly, byDepartment, totals] = await Promise.all([
        this.prisma.$queryRaw<MonthlyRow[]>(Prisma.sql`
          SELECT year, month,
                 count(*)                                              AS headcount,
                 sum(gross_amount)::text                               AS gross,
                 sum(net_amount)::text                                 AS net,
                 sum(COALESCE(deductions_amount, 0))::text             AS deductions,
                 sum(COALESCE(lop_days, 0))::text                      AS lop_days,
                 count(*) FILTER (WHERE status = 'processed')          AS paid_count,
                 count(*) FILTER (WHERE status <> 'processed')         AS pending_count
          FROM salary_payments
          WHERE (year * 100 + month) BETWEEN ${fromKey} AND ${toKey}
          GROUP BY year, month
          ORDER BY year, month
        `),
        this.prisma.$queryRaw<DepartmentRow[]>(Prisma.sql`
          SELECT d.id                                       AS department_id,
                 d.name                                     AS department_name,
                 count(*)                                   AS headcount,
                 sum(sp.gross_amount)::text                 AS gross,
                 sum(sp.net_amount)::text                   AS net,
                 sum(COALESCE(sp.deductions_amount, 0))::text AS deductions
          FROM salary_payments sp
          LEFT JOIN faculty f     ON f.id = sp.faculty_id
          LEFT JOIN departments d ON d.id = f.department_id
          WHERE (sp.year * 100 + sp.month) BETWEEN ${fromKey} AND ${toKey}
          GROUP BY d.id, d.name
          ORDER BY sum(sp.gross_amount) DESC NULLS LAST
        `),
        this.prisma.$queryRaw<
          { payslips: bigint; gross: string | null; net: string | null; deductions: string | null }[]
        >(Prisma.sql`
          SELECT count(*)                                     AS payslips,
                 sum(gross_amount)::text                      AS gross,
                 sum(net_amount)::text                        AS net,
                 sum(COALESCE(deductions_amount, 0))::text    AS deductions
          FROM salary_payments
          WHERE (year * 100 + month) BETWEEN ${fromKey} AND ${toKey}
        `),
      ]);

      const t = totals[0];
      return {
        financial_year: b.label,
        totals: {
          payslips: Number(t?.payslips ?? 0),
          gross: money(t?.gross),
          net: money(t?.net),
          deductions: money(t?.deductions),
        },
        monthly: monthly.map((r) => ({
          year: r.year,
          month: r.month,
          headcount: Number(r.headcount),
          gross: money(r.gross),
          net: money(r.net),
          deductions: money(r.deductions),
          lop_days: Number(r.lop_days ?? 0),
          paid: Number(r.paid_count),
          pending: Number(r.pending_count),
        })),
        by_department: byDepartment.map((r) => ({
          department_id: r.department_id,
          // Non-teaching staff have no faculty row, so their payments group
          // here rather than being silently dropped.
          department_name: r.department_name ?? 'Non-teaching / unassigned',
          headcount: Number(r.headcount),
          gross: money(r.gross),
          net: money(r.net),
          deductions: money(r.deductions),
        })),
      };
    } catch (err) {
      this.logger.error('DB error building payroll summary', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * GET /hr/reports/annual-statement?faculty_id=&year=
   *
   * The annual salary statement for one employee: every month's gross,
   * deductions and net for the financial year, with the component breakdown
   * from salary_divisions.
   *
   * This is deliberately NOT called a Form 16. A statutory Form 16 needs the
   * employer's TAN, the employee's PAN and a quarter-wise TDS deposit history,
   * none of which this system records — labelling this as one would produce a
   * document somebody might file. It is the salary data a Form 16 is prepared
   * *from*.
   */
  async annualStatement(facultyId: number, fy?: number) {
    const year = fy ?? financialYearOf(new Date().getUTCFullYear(), new Date().getUTCMonth() + 1);
    const b = financialYearBounds(year);
    const fromKey = b.fromYear * 100 + b.fromMonth;
    const toKey = b.toYear * 100 + b.toMonth;

    const faculty = await this.prisma.faculty.findUnique({
      where: { id: facultyId },
      select: {
        id: true,
        first_name: true,
        last_name: true,
        designation: true,
        staff_code: true,
        date_of_joining: true,
        users: { select: { email: true } },
        departments: { select: { name: true } },
      },
    });
    if (!faculty) {
      throw new NotFoundException({
        message: 'Faculty not found',
        errorCode: 'FACULTY_NOT_FOUND',
      });
    }

    try {
      const [months, divisions] = await Promise.all([
        this.prisma.$queryRaw<
          {
            year: number;
            month: number;
            gross: string;
            net: string;
            deductions: string | null;
            lop_days: number | null;
            lop_amount: string | null;
            status: string;
            paid_at: Date | null;
          }[]
        >(Prisma.sql`
          SELECT year, month,
                 gross_amount::text          AS gross,
                 net_amount::text            AS net,
                 deductions_amount::text     AS deductions,
                 lop_days,
                 lop_amount::text            AS lop_amount,
                 status::text                AS status,
                 paid_at
          FROM salary_payments
          WHERE faculty_id = ${facultyId}
            AND (year * 100 + month) BETWEEN ${fromKey} AND ${toKey}
          ORDER BY year, month
        `),
        this.prisma.salary_divisions.findMany({
          where: { faculty_id: facultyId },
          select: { division_name: true, amount: true, effective_from: true },
          orderBy: [{ effective_from: 'desc' }, { division_name: 'asc' }],
        }),
      ]);

      const grossTotal = months.reduce((sum, m) => sum + money(m.gross), 0);
      const deductionsTotal = months.reduce((sum, m) => sum + money(m.deductions), 0);
      const netTotal = months.reduce((sum, m) => sum + money(m.net), 0);

      return {
        financial_year: b.label,
        employee: {
          faculty_id: faculty.id,
          name: `${faculty.first_name} ${faculty.last_name}`.trim(),
          staff_code: faculty.staff_code,
          designation: faculty.designation,
          department: faculty.departments?.name ?? null,
          email: faculty.users?.email ?? null,
          date_of_joining: faculty.date_of_joining
            ? faculty.date_of_joining.toISOString().slice(0, 10)
            : null,
        },
        totals: {
          months_paid: months.filter((m) => m.status === 'processed').length,
          months_recorded: months.length,
          gross: grossTotal,
          deductions: deductionsTotal,
          net: netTotal,
        },
        months: months.map((m) => ({
          year: m.year,
          month: m.month,
          gross: money(m.gross),
          deductions: money(m.deductions),
          net: money(m.net),
          lop_days: m.lop_days ?? 0,
          lop_amount: money(m.lop_amount),
          status: m.status,
          paid_at: m.paid_at ? m.paid_at.toISOString() : null,
        })),
        /** Current salary structure, newest effective date first. */
        components: divisions.map((d) => ({
          name: d.division_name,
          amount: money(d.amount),
          effective_from: d.effective_from.toISOString().slice(0, 10),
        })),
        /**
         * Stated in the payload so the UI cannot present this as a filed
         * statutory return.
         */
        disclaimer:
          'Salary statement generated from recorded payroll. Not a statutory Form 16 — PAN, employer TAN and quarter-wise TDS deposits are not held in this system.',
      };
    } catch (err) {
      this.logger.error('DB error building annual statement', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * GET /hr/reports/annual-statement/available-years
   *
   * Which financial years actually have payroll recorded, so the UI offers
   * real options instead of a guessed range.
   */
  async availableYears() {
    try {
      const rows = await this.prisma.$queryRaw<{ fy: number; payslips: bigint }[]>(Prisma.sql`
        SELECT CASE WHEN month >= 4 THEN year ELSE year - 1 END AS fy,
               count(*)                                          AS payslips
        FROM salary_payments
        GROUP BY 1
        ORDER BY 1 DESC
      `);
      return rows.map((r) => ({
        financial_year_start: Number(r.fy),
        label: financialYearBounds(Number(r.fy)).label,
        payslips: Number(r.payslips),
      }));
    } catch (err) {
      this.logger.error('DB error listing payroll years', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }
}
