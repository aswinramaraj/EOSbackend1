import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { Prisma } from '../../../../generated/prisma/client';
import { HrReportsService, financialYearOf } from './hr-reports.service';
import type { HrReportDocument, HrReportSection } from './hr-report-export.util';
import { formatMoney } from './hr-report-export.util';

/**
 * Builds the downloadable HR reports.
 *
 * Every figure here is aggregated live from the operational tables —
 * `salary_payments`, `salary_divisions`, `faculty`, `non_teaching_staff`,
 * `faculty_leaves`, `faculty_od_requests`. Nothing is cached or precomputed, so
 * an export always matches what the screens show for the same filters.
 *
 * Two things worth knowing before reading the queries:
 *
 * - `salary_payment_status_enum` is `processed | pending | hold`. There is no
 *   'paid' — "processed" is what counts as money out of the door.
 * - `salary_payments.payee_type` is `faculty | staff`. Staff payslips have a
 *   null `faculty_id`, so every department join is a LEFT JOIN and they group
 *   under "Non-teaching / unassigned" instead of disappearing.
 */

export const HR_REPORT_KINDS = [
  'payroll-register',
  'department-cost',
  'employee-payroll',
  'staff-headcount',
  'salary-structure',
  'leave-od-utilisation',
  'annual-statement',
] as const;

export type HrReportKind = (typeof HR_REPORT_KINDS)[number];

export function isHrReportKind(value: string): value is HrReportKind {
  return (HR_REPORT_KINDS as readonly string[]).includes(value);
}

const MONTHS = [
  '',
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

function monthLabel(year: number, month: number): string {
  return `${MONTHS[month] ?? month} ${year}`;
}

function num(v: { toString(): string } | null | undefined): number {
  return v == null ? 0 : Number(v.toString());
}

function fyLabel(fy: number): string {
  return `${fy}-${String((fy + 1) % 100).padStart(2, '0')}`;
}

function currentFy(): number {
  const now = new Date();
  return financialYearOf(now.getUTCFullYear(), now.getUTCMonth() + 1);
}

/** April–March expressed as a single comparable year*100+month key. */
function fyKeys(fy: number): { fromKey: number; toKey: number } {
  return { fromKey: fy * 100 + 4, toKey: (fy + 1) * 100 + 3 };
}

function pct(part: number, whole: number): string {
  if (whole <= 0) return '—';
  return `${((part / whole) * 100).toFixed(1)}%`;
}

@Injectable()
export class HrReportDocumentsService {
  private readonly logger = new Logger(HrReportDocumentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly reports: HrReportsService,
  ) {}

  /** Catalogue for the Reports page, so the UI never offers a report that cannot be built. */
  catalogue() {
    return [
      {
        kind: 'payroll-register' as HrReportKind,
        title: 'Monthly payroll register',
        group: 'Payroll',
        description:
          'Month-by-month gross, deductions, net, LOP and run status for the financial year, with the department split.',
        needs_faculty: false,
      },
      {
        kind: 'department-cost' as HrReportKind,
        title: 'Department-wise payroll cost',
        group: 'Payroll',
        description:
          'Payroll cost per department with each department’s share of total gross and its average cost per payslip.',
        needs_faculty: false,
      },
      {
        kind: 'employee-payroll' as HrReportKind,
        title: 'Employee payroll register',
        group: 'Payroll',
        description:
          'One row per payslip — employee, roll number, department, month, gross, deductions, LOP and net.',
        needs_faculty: false,
      },
      {
        kind: 'salary-structure' as HrReportKind,
        title: 'Salary structure register',
        group: 'Payroll',
        description:
          'Recorded salary components per employee from salary_divisions, with the component-wise college total.',
        needs_faculty: false,
      },
      {
        kind: 'staff-headcount' as HrReportKind,
        title: 'Staff strength by department',
        group: 'Establishment',
        description:
          'Teaching and non-teaching headcount per department, split by status, with the designation mix.',
        needs_faculty: false,
      },
      {
        kind: 'leave-od-utilisation' as HrReportKind,
        title: 'Leave and OD utilisation',
        group: 'Establishment',
        description:
          'Leave and on-duty requests per department for the financial year, by approval outcome, with days taken.',
        needs_faculty: false,
      },
      {
        kind: 'annual-statement' as HrReportKind,
        title: 'Annual salary statement',
        group: 'Employee',
        description:
          'One employee’s month-by-month salary for the year plus their salary structure — the payroll basis for a Form 16.',
        needs_faculty: true,
      },
    ];
  }

  async build(
    kind: HrReportKind,
    opts: { fy?: number; departmentId?: number; facultyId?: number },
  ): Promise<HrReportDocument> {
    const fy = opts.fy ?? currentFy();
    try {
      switch (kind) {
        case 'payroll-register':
          return await this.payrollRegister(fy);
        case 'department-cost':
          return await this.departmentCost(fy);
        case 'employee-payroll':
          return await this.employeePayroll(fy, opts.departmentId);
        case 'salary-structure':
          return await this.salaryStructure(opts.departmentId);
        case 'staff-headcount':
          return await this.staffHeadcount();
        case 'leave-od-utilisation':
          return await this.leaveOdUtilisation(fy);
        case 'annual-statement':
          return await this.annualStatementDocument(fy, opts.facultyId);
      }
    } catch (err) {
      if (
        err instanceof BadRequestException ||
        err instanceof InternalServerErrorException
      ) {
        throw err;
      }
      this.logger.error(`DB error building HR report "${kind}"`, err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  // ── Payroll ────────────────────────────────────────────────────────────────

  /**
   * Reuses HrReportsService.payrollSummary so the exported register can never
   * drift from the figures the Reports page shows for the same year.
   */
  private async payrollRegister(fy: number): Promise<HrReportDocument> {
    const s = await this.reports.payrollSummary(fy);

    const monthly: HrReportSection = {
      heading: 'Monthly payroll register',
      note: 'A month counts as fully processed only when every payslip in it has status "processed".',
      columns: [
        { header: 'Month', key: 'month', width: 1.4 },
        { header: 'Payslips', key: 'headcount', width: 0.8, number: true },
        { header: 'Gross', key: 'gross', width: 1.2, money: true },
        { header: 'Deductions', key: 'deductions', width: 1.2, money: true },
        { header: 'Net paid', key: 'net', width: 1.2, money: true },
        { header: 'LOP days', key: 'lop_days', width: 0.8, number: true },
        { header: 'Processed', key: 'paid', width: 0.8, number: true },
        { header: 'Pending', key: 'pending', width: 0.8, number: true },
      ],
      rows: s.monthly.map((m) => ({
        month: monthLabel(m.year, m.month),
        headcount: m.headcount,
        gross: m.gross,
        deductions: m.deductions,
        net: m.net,
        lop_days: m.lop_days,
        paid: m.paid,
        pending: m.pending,
      })),
      totals: {
        month: 'Total',
        headcount: s.totals.payslips,
        gross: s.totals.gross,
        deductions: s.totals.deductions,
        net: s.totals.net,
        lop_days: s.monthly.reduce((a, m) => a + m.lop_days, 0),
        paid: s.monthly.reduce((a, m) => a + m.paid, 0),
        pending: s.monthly.reduce((a, m) => a + m.pending, 0),
      },
      emptyMessage: 'No payroll recorded in this financial year.',
    };

    const byDept: HrReportSection = {
      heading: 'Department split',
      columns: [
        { header: 'Department', key: 'department', width: 3 },
        { header: 'Payslips', key: 'headcount', width: 0.8, number: true },
        { header: 'Gross', key: 'gross', width: 1.2, money: true },
        { header: 'Deductions', key: 'deductions', width: 1.2, money: true },
        { header: 'Net paid', key: 'net', width: 1.2, money: true },
      ],
      rows: s.by_department.map((d) => ({
        department: d.department_name,
        headcount: d.headcount,
        gross: d.gross,
        deductions: d.deductions,
        net: d.net,
      })),
      totals: {
        department: 'Total',
        headcount: s.totals.payslips,
        gross: s.totals.gross,
        deductions: s.totals.deductions,
        net: s.totals.net,
      },
      emptyMessage: 'No department breakdown available.',
    };

    return {
      title: 'Monthly Payroll Register',
      subtitle: 'Payroll summed from recorded payslips, month by month',
      scope: `Financial year ${s.financial_year}`,
      kpis: [
        { label: 'Payslips', value: s.totals.payslips.toLocaleString('en-IN') },
        { label: 'Gross', value: formatMoney(s.totals.gross) },
        { label: 'Deductions', value: formatMoney(s.totals.deductions) },
        { label: 'Net paid', value: formatMoney(s.totals.net) },
      ],
      sections: [monthly, byDept],
    };
  }

  private async departmentCost(fy: number): Promise<HrReportDocument> {
    const s = await this.reports.payrollSummary(fy);
    const totalGross = s.totals.gross;

    const rows = s.by_department.map((d) => ({
      department: d.department_name,
      headcount: d.headcount,
      gross: d.gross,
      share: pct(d.gross, totalGross),
      deductions: d.deductions,
      net: d.net,
      average: d.headcount > 0 ? Math.round(d.gross / d.headcount) : 0,
    }));

    return {
      title: 'Department-wise Payroll Cost',
      subtitle: 'Cost per department, its share of total gross, and average cost per payslip',
      scope: `Financial year ${s.financial_year}`,
      kpis: [
        { label: 'Departments with payroll', value: String(s.by_department.length) },
        { label: 'Total gross', value: formatMoney(totalGross) },
        { label: 'Total net', value: formatMoney(s.totals.net) },
        {
          label: 'Highest cost',
          value: s.by_department[0] ? formatMoney(s.by_department[0].gross) : '—',
        },
      ],
      sections: [
        {
          heading: 'Cost by department',
          note: 'Ordered by gross cost. Non-teaching payslips carry no department on the record, so they group at the end.',
          columns: [
            { header: 'Department', key: 'department', width: 3 },
            { header: 'Payslips', key: 'headcount', width: 0.8, number: true },
            { header: 'Gross', key: 'gross', width: 1.2, money: true },
            { header: 'Share', key: 'share', width: 0.7, align: 'right' },
            { header: 'Deductions', key: 'deductions', width: 1.2, money: true },
            { header: 'Net paid', key: 'net', width: 1.2, money: true },
            { header: 'Avg / payslip', key: 'average', width: 1.1, money: true },
          ],
          rows,
          totals: {
            department: 'Total',
            headcount: s.totals.payslips,
            gross: totalGross,
            share: totalGross > 0 ? '100.0%' : '—',
            deductions: s.totals.deductions,
            net: s.totals.net,
            average: s.totals.payslips > 0 ? Math.round(totalGross / s.totals.payslips) : 0,
          },
          emptyMessage: 'No payroll recorded in this financial year.',
        },
      ],
    };
  }

  private async employeePayroll(fy: number, departmentId?: number): Promise<HrReportDocument> {
    const { fromKey, toKey } = fyKeys(fy);

    const rows = await this.prisma.$queryRaw<
      {
        name: string | null;
        staff_code: string | null;
        designation: string | null;
        department_name: string | null;
        year: number;
        month: number;
        gross: string;
        deductions: string | null;
        net: string;
        lop_days: number | null;
        status: string;
        paid_at: Date | null;
      }[]
    >(Prisma.sql`
      SELECT COALESCE(
               NULLIF(TRIM(CONCAT_WS(' ', f.first_name, f.last_name)), ''),
               NULLIF(TRIM(CONCAT_WS(' ', nts.first_name, nts.last_name)), '')
             )                                            AS name,
             f.staff_code                                 AS staff_code,
             -- non_teaching_staff.category is staff_category_enum, not text, so
             -- COALESCE against f.designation (varchar) needs the cast or
             -- Postgres refuses to match the two types.
             COALESCE(f.designation, nts.category::text)   AS designation,
             COALESCE(fd.name, nd.name)                   AS department_name,
             sp.year, sp.month,
             sp.gross_amount::text                        AS gross,
             sp.deductions_amount::text                   AS deductions,
             sp.net_amount::text                          AS net,
             sp.lop_days,
             sp.status::text                              AS status,
             sp.paid_at
      FROM salary_payments sp
      LEFT JOIN faculty f              ON f.id  = sp.faculty_id
      LEFT JOIN departments fd         ON fd.id = f.department_id
      LEFT JOIN non_teaching_staff nts ON nts.id = sp.staff_id
      LEFT JOIN departments nd         ON nd.id = nts.department_id
      WHERE (sp.year * 100 + sp.month) BETWEEN ${fromKey} AND ${toKey}
        ${departmentId ? Prisma.sql`AND COALESCE(f.department_id, nts.department_id) = ${departmentId}` : Prisma.empty}
      ORDER BY sp.year, sp.month, name
    `);

    const gross = rows.reduce((a, r) => a + num(r.gross), 0);
    const deductions = rows.reduce((a, r) => a + num(r.deductions), 0);
    const net = rows.reduce((a, r) => a + num(r.net), 0);
    const processed = rows.filter((r) => r.status === 'processed').length;

    const department = departmentId
      ? await this.prisma.departments.findUnique({
          where: { id: departmentId },
          select: { name: true },
        })
      : null;

    return {
      title: 'Employee Payroll Register',
      subtitle: 'One row per recorded payslip',
      scope: `Financial year ${fyLabel(fy)}${department ? ` · ${department.name}` : ''}`,
      kpis: [
        { label: 'Payslips', value: rows.length.toLocaleString('en-IN') },
        { label: 'Processed', value: `${processed} of ${rows.length}` },
        { label: 'Gross', value: formatMoney(gross) },
        { label: 'Net paid', value: formatMoney(net) },
      ],
      sections: [
        {
          heading: 'Payslip detail',
          note: 'Status "processed" means the payment has been run; "pending" and "hold" have not left the college.',
          columns: [
            { header: 'Employee', key: 'name', width: 2 },
            { header: 'Roll no', key: 'staff_code', width: 0.9 },
            { header: 'Designation', key: 'designation', width: 1.4 },
            { header: 'Department', key: 'department_name', width: 2.2 },
            { header: 'Month', key: 'month', width: 1.1 },
            { header: 'Gross', key: 'gross', width: 1.1, money: true },
            { header: 'Deductions', key: 'deductions', width: 1.1, money: true },
            { header: 'LOP', key: 'lop_days', width: 0.55, number: true },
            { header: 'Net', key: 'net', width: 1.1, money: true },
            { header: 'Status', key: 'status', width: 0.85 },
          ],
          rows: rows.map((r) => ({
            name: r.name ?? '—',
            staff_code: r.staff_code ?? '—',
            designation: r.designation ?? '—',
            department_name: r.department_name ?? 'Non-teaching / unassigned',
            month: monthLabel(r.year, r.month),
            gross: num(r.gross),
            deductions: num(r.deductions),
            lop_days: r.lop_days ?? 0,
            net: num(r.net),
            status: r.status,
          })),
          totals: {
            name: `Total — ${rows.length} payslips`,
            gross,
            deductions,
            lop_days: rows.reduce((a, r) => a + (r.lop_days ?? 0), 0),
            net,
          },
          emptyMessage: 'No payslips recorded for this year and department.',
        },
      ],
    };
  }

  private async salaryStructure(departmentId?: number): Promise<HrReportDocument> {
    const [rows, byComponent] = await Promise.all([
      this.prisma.$queryRaw<
        {
          name: string;
          staff_code: string | null;
          designation: string;
          department_name: string | null;
          division_name: string;
          amount: string;
          effective_from: Date;
        }[]
      >(Prisma.sql`
        SELECT TRIM(CONCAT_WS(' ', f.first_name, f.last_name)) AS name,
               f.staff_code,
               f.designation,
               d.name                                          AS department_name,
               sd.division_name,
               sd.amount::text                                 AS amount,
               sd.effective_from
        FROM salary_divisions sd
        JOIN faculty f          ON f.id = sd.faculty_id
        LEFT JOIN departments d ON d.id = f.department_id
        ${departmentId ? Prisma.sql`WHERE f.department_id = ${departmentId}` : Prisma.empty}
        ORDER BY d.name NULLS LAST, name, sd.effective_from DESC, sd.division_name
      `),
      this.prisma.$queryRaw<{ division_name: string; employees: bigint; total: string }[]>(Prisma.sql`
        SELECT sd.division_name,
               count(DISTINCT sd.faculty_id) AS employees,
               sum(sd.amount)::text          AS total
        FROM salary_divisions sd
        JOIN faculty f ON f.id = sd.faculty_id
        ${departmentId ? Prisma.sql`WHERE f.department_id = ${departmentId}` : Prisma.empty}
        GROUP BY sd.division_name
        ORDER BY sum(sd.amount) DESC
      `),
    ]);

    const total = rows.reduce((a, r) => a + num(r.amount), 0);
    const employees = new Set(rows.map((r) => r.staff_code ?? r.name)).size;

    const department = departmentId
      ? await this.prisma.departments.findUnique({
          where: { id: departmentId },
          select: { name: true },
        })
      : null;

    return {
      title: 'Salary Structure Register',
      subtitle: 'Recorded salary components per employee',
      scope: department ? department.name : 'All departments',
      kpis: [
        { label: 'Employees with a structure', value: String(employees) },
        { label: 'Component rows', value: String(rows.length) },
        { label: 'Distinct components', value: String(byComponent.length) },
        { label: 'Total of all components', value: formatMoney(total) },
      ],
      sections: [
        {
          heading: 'Component-wise summary',
          columns: [
            { header: 'Component', key: 'division_name', width: 2 },
            { header: 'Employees', key: 'employees', width: 1, number: true },
            { header: 'Total amount', key: 'total', width: 1.4, money: true },
          ],
          rows: byComponent.map((c) => ({
            division_name: c.division_name,
            employees: Number(c.employees),
            total: num(c.total),
          })),
          totals: { division_name: 'Total', total },
          emptyMessage: 'No salary components recorded.',
        },
        {
          heading: 'Employee-wise components',
          note: 'Most recent effective date first for each employee. A component is only listed if it has been recorded against them.',
          columns: [
            { header: 'Employee', key: 'name', width: 2 },
            { header: 'Roll no', key: 'staff_code', width: 0.9 },
            { header: 'Designation', key: 'designation', width: 1.5 },
            { header: 'Department', key: 'department_name', width: 2.4 },
            { header: 'Component', key: 'division_name', width: 1.5 },
            { header: 'Amount', key: 'amount', width: 1.2, money: true },
            { header: 'Effective from', key: 'effective_from', width: 1.1 },
          ],
          rows: rows.map((r) => ({
            name: r.name,
            staff_code: r.staff_code ?? '—',
            designation: r.designation,
            department_name: r.department_name ?? '—',
            division_name: r.division_name,
            amount: num(r.amount),
            effective_from: r.effective_from.toISOString().slice(0, 10),
          })),
          totals: { name: `Total — ${rows.length} rows`, amount: total },
          emptyMessage: 'No salary components recorded for this department.',
        },
      ],
    };
  }

  // ── Establishment ──────────────────────────────────────────────────────────

  private async staffHeadcount(): Promise<HrReportDocument> {
    const [byDept, byDesignation, staffTotals] = await Promise.all([
      this.prisma.$queryRaw<
        {
          department_name: string | null;
          code: string | null;
          teaching: bigint;
          teaching_active: bigint;
          non_teaching: bigint;
          non_teaching_active: bigint;
        }[]
      >(Prisma.sql`
        -- Scalar subqueries, NOT two LEFT JOINs. Joining faculty and
        -- non_teaching_staff to departments in one query multiplies them
        -- together: 50 faculty x 4 staff counts as 200 of each, so a
        -- 500-strong college reported 4,000 people and the rows did not even
        -- add up to the report's own total.
        SELECT d.name AS department_name,
               d.code,
               (SELECT count(*) FROM faculty f
                 WHERE f.department_id = d.id)                          AS teaching,
               (SELECT count(*) FROM faculty f
                 WHERE f.department_id = d.id AND f.status = 'active')   AS teaching_active,
               (SELECT count(*) FROM non_teaching_staff nts
                 WHERE nts.department_id = d.id)                         AS non_teaching,
               (SELECT count(*) FROM non_teaching_staff nts
                 WHERE nts.department_id = d.id AND nts.status = 'active') AS non_teaching_active
        FROM departments d
        ORDER BY d.name
      `),
      this.prisma.$queryRaw<{ designation: string; headcount: bigint; active: bigint }[]>(Prisma.sql`
        SELECT designation,
               count(*)                                    AS headcount,
               count(*) FILTER (WHERE status = 'active')    AS active
        FROM faculty
        GROUP BY designation
        ORDER BY count(*) DESC
      `),
      this.prisma.$queryRaw<
        { teaching: bigint; teaching_active: bigint; non_teaching: bigint; non_teaching_active: bigint }[]
      >(Prisma.sql`
        SELECT (SELECT count(*) FROM faculty)                                       AS teaching,
               (SELECT count(*) FROM faculty WHERE status = 'active')               AS teaching_active,
               (SELECT count(*) FROM non_teaching_staff)                            AS non_teaching,
               (SELECT count(*) FROM non_teaching_staff WHERE status = 'active')     AS non_teaching_active
      `),
    ]);

    const t = staffTotals[0];
    const teaching = Number(t?.teaching ?? 0);
    const teachingActive = Number(t?.teaching_active ?? 0);
    const nonTeaching = Number(t?.non_teaching ?? 0);
    const nonTeachingActive = Number(t?.non_teaching_active ?? 0);

    return {
      title: 'Staff Strength by Department',
      subtitle: 'Teaching and non-teaching headcount on record',
      scope: `As on ${new Date().toISOString().slice(0, 10)}`,
      kpis: [
        { label: 'Teaching staff', value: `${teachingActive} active of ${teaching}` },
        { label: 'Non-teaching staff', value: `${nonTeachingActive} active of ${nonTeaching}` },
        { label: 'Total on record', value: String(teaching + nonTeaching) },
        { label: 'Departments', value: String(byDept.length) },
      ],
      sections: [
        {
          heading: 'Headcount by department',
          note: 'A department appears even with no staff recorded against it, so a gap is visible rather than absent.',
          columns: [
            { header: 'Department', key: 'department_name', width: 3 },
            { header: 'Code', key: 'code', width: 0.7 },
            { header: 'Teaching', key: 'teaching', width: 0.9, number: true },
            { header: 'Teaching active', key: 'teaching_active', width: 1, number: true },
            { header: 'Non-teaching', key: 'non_teaching', width: 1, number: true },
            { header: 'Non-teaching active', key: 'non_teaching_active', width: 1.2, number: true },
            { header: 'Total', key: 'total', width: 0.8, number: true },
          ],
          rows: byDept.map((d) => ({
            department_name: d.department_name ?? '—',
            code: d.code ?? '—',
            teaching: Number(d.teaching),
            teaching_active: Number(d.teaching_active),
            non_teaching: Number(d.non_teaching),
            non_teaching_active: Number(d.non_teaching_active),
            total: Number(d.teaching) + Number(d.non_teaching),
          })),
          totals: {
            department_name: 'Total',
            teaching,
            teaching_active: teachingActive,
            non_teaching: nonTeaching,
            non_teaching_active: nonTeachingActive,
            total: teaching + nonTeaching,
          },
          emptyMessage: 'No departments recorded.',
        },
        {
          heading: 'Designation mix',
          note: 'Teaching staff only. Non-teaching staff are recorded by category, not designation.',
          columns: [
            { header: 'Designation', key: 'designation', width: 2.5 },
            { header: 'On record', key: 'headcount', width: 1, number: true },
            { header: 'Active', key: 'active', width: 1, number: true },
            { header: 'Share', key: 'share', width: 1, align: 'right' },
          ],
          rows: byDesignation.map((r) => ({
            designation: r.designation,
            headcount: Number(r.headcount),
            active: Number(r.active),
            share: pct(Number(r.headcount), teaching),
          })),
          totals: {
            designation: 'Total',
            headcount: teaching,
            active: teachingActive,
            share: teaching > 0 ? '100.0%' : '—',
          },
          emptyMessage: 'No teaching staff recorded.',
        },
      ],
    };
  }

  private async leaveOdUtilisation(fy: number): Promise<HrReportDocument> {
    // Leaves and ODs are dated, not month-numbered, so the FY is a date range
    // here rather than the year*100+month key used for payroll.
    const from = new Date(Date.UTC(fy, 3, 1));
    const to = new Date(Date.UTC(fy + 1, 2, 31));

    const [leaves, ods] = await Promise.all([
      this.prisma.$queryRaw<
        {
          department_name: string | null;
          requests: bigint;
          approved: bigint;
          rejected: bigint;
          pending: bigint;
          days: string | null;
        }[]
      >(Prisma.sql`
        SELECT d.name AS department_name,
               count(*)                                                          AS requests,
               count(*) FILTER (WHERE fl.hr_approval_status = 'approved')         AS approved,
               count(*) FILTER (WHERE fl.hr_approval_status = 'rejected')         AS rejected,
               count(*) FILTER (WHERE fl.hr_approval_status = 'pending')          AS pending,
               sum(fl.to_date - fl.from_date + 1)::text                           AS days
        FROM faculty_leaves fl
        LEFT JOIN faculty f     ON f.id = fl.faculty_id
        LEFT JOIN departments d ON d.id = f.department_id
        WHERE fl.from_date <= ${to} AND fl.to_date >= ${from}
        GROUP BY d.name
        ORDER BY count(*) DESC
      `),
      this.prisma.$queryRaw<
        {
          department_name: string | null;
          requests: bigint;
          approved: bigint;
          rejected: bigint;
          pending: bigint;
          days: string | null;
        }[]
      >(Prisma.sql`
        SELECT d.name AS department_name,
               count(*)                                                          AS requests,
               count(*) FILTER (WHERE od.hr_approval_status = 'approved')         AS approved,
               count(*) FILTER (WHERE od.hr_approval_status = 'rejected')         AS rejected,
               count(*) FILTER (WHERE od.hr_approval_status = 'pending')          AS pending,
               sum(od.to_date - od.from_date + 1)::text                           AS days
        FROM faculty_od_requests od
        LEFT JOIN faculty f     ON f.id = od.faculty_id
        LEFT JOIN departments d ON d.id = f.department_id
        WHERE od.from_date <= ${to} AND od.to_date >= ${from}
        GROUP BY d.name
        ORDER BY count(*) DESC
      `),
    ]);

    const sumOf = (rows: typeof leaves, key: 'requests' | 'approved' | 'rejected' | 'pending') =>
      rows.reduce((a, r) => a + Number(r[key]), 0);
    const daysOf = (rows: typeof leaves) => rows.reduce((a, r) => a + num(r.days), 0);

    const columns = [
      { header: 'Department', key: 'department_name', width: 3 },
      { header: 'Requests', key: 'requests', width: 1, number: true },
      { header: 'Approved', key: 'approved', width: 1, number: true },
      { header: 'Rejected', key: 'rejected', width: 1, number: true },
      { header: 'Pending', key: 'pending', width: 1, number: true },
      { header: 'Days', key: 'days', width: 0.9, number: true },
    ];

    const shape = (rows: typeof leaves) =>
      rows.map((r) => ({
        department_name: r.department_name ?? 'Non-teaching / unassigned',
        requests: Number(r.requests),
        approved: Number(r.approved),
        rejected: Number(r.rejected),
        pending: Number(r.pending),
        days: num(r.days),
      }));

    return {
      title: 'Leave and OD Utilisation',
      subtitle: 'Requests overlapping the financial year, by department and approval outcome',
      scope: `Financial year ${fyLabel(fy)}`,
      kpis: [
        { label: 'Leave requests', value: String(sumOf(leaves, 'requests')) },
        { label: 'Leave days', value: String(daysOf(leaves)) },
        { label: 'OD requests', value: String(sumOf(ods, 'requests')) },
        { label: 'OD days', value: String(daysOf(ods)) },
      ],
      sections: [
        {
          heading: 'Leave by department',
          note: 'Outcome is the HR decision. Days count calendar days inclusive of both end dates.',
          columns,
          rows: shape(leaves),
          totals: {
            department_name: 'Total',
            requests: sumOf(leaves, 'requests'),
            approved: sumOf(leaves, 'approved'),
            rejected: sumOf(leaves, 'rejected'),
            pending: sumOf(leaves, 'pending'),
            days: daysOf(leaves),
          },
          emptyMessage: 'No leave requests overlap this financial year.',
        },
        {
          heading: 'On duty by department',
          columns,
          rows: shape(ods),
          totals: {
            department_name: 'Total',
            requests: sumOf(ods, 'requests'),
            approved: sumOf(ods, 'approved'),
            rejected: sumOf(ods, 'rejected'),
            pending: sumOf(ods, 'pending'),
            days: daysOf(ods),
          },
          emptyMessage: 'No OD requests overlap this financial year.',
        },
      ],
    };
  }

  // ── Employee ───────────────────────────────────────────────────────────────

  /**
   * Portrait, because this is a per-person document that gets filed or handed
   * over rather than scanned across like a register.
   */
  private async annualStatementDocument(fy: number, facultyId?: number): Promise<HrReportDocument> {
    if (!facultyId) {
      throw new BadRequestException({
        message: 'Choose an employee before exporting an annual salary statement.',
        errorCode: 'FACULTY_REQUIRED',
      });
    }

    const s = await this.reports.annualStatement(facultyId, fy);

    return {
      title: 'Annual Salary Statement',
      subtitle: 'Month-by-month salary, deductions and net pay on record',
      scope: `Financial year ${s.financial_year}`,
      orientation: 'portrait',
      meta: [
        { label: 'Employee', value: s.employee.name },
        { label: 'Roll no', value: s.employee.staff_code ?? '—' },
        { label: 'Designation', value: s.employee.designation },
        { label: 'Department', value: s.employee.department ?? '—' },
        { label: 'Email', value: s.employee.email ?? '—' },
        { label: 'Date of joining', value: s.employee.date_of_joining ?? '—' },
      ],
      kpis: [
        { label: 'Gross earned', value: formatMoney(s.totals.gross) },
        { label: 'Deductions', value: formatMoney(s.totals.deductions) },
        { label: 'Net paid', value: formatMoney(s.totals.net) },
        {
          label: 'Months processed',
          value: `${s.totals.months_paid} of ${s.totals.months_recorded}`,
        },
      ],
      sections: [
        {
          heading: 'Month-by-month',
          columns: [
            { header: 'Month', key: 'month', width: 1.4 },
            { header: 'Gross', key: 'gross', width: 1.2, money: true },
            { header: 'Deductions', key: 'deductions', width: 1.2, money: true },
            { header: 'Net', key: 'net', width: 1.2, money: true },
            { header: 'LOP', key: 'lop_days', width: 0.6, number: true },
            { header: 'Status', key: 'status', width: 0.9 },
          ],
          rows: s.months.map((m) => ({
            month: monthLabel(m.year, m.month),
            gross: m.gross,
            deductions: m.deductions,
            net: m.net,
            lop_days: m.lop_days,
            status: m.status,
          })),
          totals: {
            month: 'Total',
            gross: s.totals.gross,
            deductions: s.totals.deductions,
            net: s.totals.net,
            lop_days: s.months.reduce((a, m) => a + m.lop_days, 0),
          },
          emptyMessage: 'No payslips recorded for this employee in this year.',
        },
        {
          heading: 'Salary structure on record',
          note: 'Most recent effective date first.',
          columns: [
            { header: 'Component', key: 'name', width: 2 },
            { header: 'Amount', key: 'amount', width: 1.2, money: true },
            { header: 'Effective from', key: 'effective_from', width: 1.2 },
          ],
          rows: s.components.map((c) => ({
            name: c.name,
            amount: c.amount,
            effective_from: c.effective_from,
          })),
          totals: {
            name: 'Total of components',
            amount: s.components.reduce((a, c) => a + c.amount, 0),
          },
          emptyMessage: 'No salary components recorded for this employee.',
        },
      ],
      footnote: s.disclaimer,
    };
  }
}
