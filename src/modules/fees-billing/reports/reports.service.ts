import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { Prisma } from '../../../../generated/prisma/client';
import type { ReportTable } from 'src/common/utils/report-export.util';

function studentName(soa: { first_name: string; last_name: string } | null): string {
  if (!soa) return '—';
  return [soa.first_name, soa.last_name].filter(Boolean).join(' ') || '—';
}

function dec(v: Prisma.Decimal | number): Prisma.Decimal {
  return v instanceof Prisma.Decimal ? v : new Prisma.Decimal(v);
}

/**
 * Real 6-mode → display-column mapping for the Daily Collection Summary
 * report (see reports.controller.ts header comment for the exact real
 * payment_mode_enum values this maps from): cash + card = "Counter",
 * upi + netbanking + razorpay = "Online", dd = "DD". Each real mode also
 * gets its own raw column so nothing is hidden behind the grouping.
 */
const MODE_COLUMNS = ['cash', 'card', 'upi', 'netbanking', 'dd', 'razorpay'] as const;

@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);

  constructor(private readonly prisma: PrismaService) {}

  private fail(context: string, err: unknown): never {
    this.logger.error(`DB error while building ${context}`, err);
    throw new InternalServerErrorException({
      message: 'Something went wrong. Please try again.',
      errorCode: 'INTERNAL_ERROR',
    });
  }

  // ── 1. Demand vs Collection (by Department + Quota) ─────────────────────

  private async queryDemandVsCollectionRows() {
    return this.prisma.student_fee_demand_mapping.findMany({
      select: {
        fee_payments: { select: { amount_paid: true } },
        fee_structures: { select: { fee_structure_items: { select: { amount: true } } } },
        students: {
          select: {
            courses: { select: { departments: { select: { name: true } } } },
            quotas: { select: { name: true } },
          },
        },
      },
    });
  }

  async buildDemandVsCollectionTable(): Promise<ReportTable> {
    let rows: Awaited<ReturnType<typeof this.queryDemandVsCollectionRows>>;
    try {
      rows = await this.queryDemandVsCollectionRows();
    } catch (err) {
      this.fail('demand vs collection report', err);
    }

    const totals = new Map<
      string,
      { department: string; quota: string; demand: Prisma.Decimal; collected: Prisma.Decimal }
    >();

    for (const row of rows) {
      const department = row.students.courses.departments.name;
      const quota = row.students.quotas.name;
      const key = `${department}::${quota}`;
      const demand = row.fee_structures.fee_structure_items.reduce(
        (sum, item) => sum.plus(item.amount),
        new Prisma.Decimal(0),
      );
      const collected = row.fee_payments.reduce(
        (sum, p) => sum.plus(p.amount_paid),
        new Prisma.Decimal(0),
      );

      const running = totals.get(key) ?? {
        department,
        quota,
        demand: new Prisma.Decimal(0),
        collected: new Prisma.Decimal(0),
      };
      running.demand = running.demand.plus(demand);
      running.collected = running.collected.plus(collected);
      totals.set(key, running);
    }

    const sorted = [...totals.values()].sort(
      (a, b) => a.department.localeCompare(b.department) || a.quota.localeCompare(b.quota),
    );

    return {
      title: 'Demand vs Collection',
      columns: [
        { header: 'Department', key: 'department', width: 26 },
        { header: 'Quota', key: 'quota', width: 20 },
        { header: 'Demand Raised', key: 'demand_raised', width: 18 },
        { header: 'Collected', key: 'collected', width: 18 },
        { header: 'Outstanding', key: 'outstanding', width: 18 },
      ],
      rows: sorted.map((r) => ({
        department: r.department,
        quota: r.quota,
        demand_raised: r.demand.toFixed(2),
        collected: r.collected.toFixed(2),
        outstanding: (r.demand.isNegative() ? new Prisma.Decimal(0) : r.demand.minus(r.collected)).toFixed(2),
      })),
    };
  }

  // ── 2. Department-wise Collection (reuses finance-overview's grouping) ──

  private async queryDepartmentMappings() {
    return this.prisma.student_fee_demand_mapping.findMany({
      select: {
        fee_payments: { select: { amount_paid: true } },
        fee_structures: { select: { fee_structure_items: { select: { amount: true } } } },
        students: { select: { courses: { select: { departments: { select: { name: true } } } } } },
      },
    });
  }

  async buildDepartmentCollectionTable(): Promise<ReportTable> {
    let rows: Awaited<ReturnType<typeof this.queryDepartmentMappings>>;
    try {
      rows = await this.queryDepartmentMappings();
    } catch (err) {
      this.fail('department-wise collection report', err);
    }

    const totals = new Map<string, { demand: Prisma.Decimal; collected: Prisma.Decimal }>();

    for (const row of rows) {
      const department = row.students.courses.departments.name;
      const demand = row.fee_structures.fee_structure_items.reduce(
        (sum, item) => sum.plus(item.amount),
        new Prisma.Decimal(0),
      );
      const collected = row.fee_payments.reduce(
        (sum, p) => sum.plus(p.amount_paid),
        new Prisma.Decimal(0),
      );
      const running = totals.get(department) ?? { demand: new Prisma.Decimal(0), collected: new Prisma.Decimal(0) };
      running.demand = running.demand.plus(demand);
      running.collected = running.collected.plus(collected);
      totals.set(department, running);
    }

    const sorted = [...totals.entries()].sort((a, b) => a[0].localeCompare(b[0]));

    return {
      title: 'Department-wise Collection',
      columns: [
        { header: 'Department', key: 'department', width: 28 },
        { header: 'Total Demand', key: 'total_demand', width: 18 },
        { header: 'Collected', key: 'collected', width: 18 },
        { header: 'Outstanding', key: 'outstanding', width: 18 },
        { header: 'Collection %', key: 'collection_pct', width: 14 },
      ],
      rows: sorted.map(([department, t]) => {
        const outstanding = t.demand.isNegative() ? new Prisma.Decimal(0) : t.demand.minus(t.collected);
        const pct = t.demand.greaterThan(0)
          ? t.collected.dividedBy(t.demand).times(100).toDecimalPlaces(2).toNumber()
          : 0;
        return {
          department,
          total_demand: t.demand.toFixed(2),
          collected: t.collected.toFixed(2),
          outstanding: outstanding.toFixed(2),
          collection_pct: `${pct}%`,
        };
      }),
    };
  }

  // ── 3. Concession Register ───────────────────────────────────────────────
  // fee_concessions only has {id, fee_structure_id, concession_amount,
  // is_settled, settled_date} — no reason/category/approving-officer in the
  // real schema. Not fabricated here; the frontend surfaces that gap with a
  // banner instead of hiding it.

  async buildConcessionRegisterTable(): Promise<ReportTable> {
    let concessions;
    try {
      concessions = await this.prisma.fee_concessions.findMany({
        select: {
          id: true,
          concession_amount: true,
          is_settled: true,
          settled_date: true,
          fee_structures: {
            select: {
              name: true,
              student_fee_demand_mapping: {
                take: 1,
                select: {
                  students: {
                    select: {
                      register_no: true,
                      soa_applications: { select: { first_name: true, last_name: true } },
                    },
                  },
                },
              },
            },
          },
        },
        orderBy: { id: 'desc' },
      });
    } catch (err) {
      this.fail('concession register report', err);
    }

    return {
      title: 'Concession Register',
      columns: [
        { header: 'Student', key: 'student', width: 22 },
        { header: 'Register No.', key: 'register_no', width: 16 },
        { header: 'Fee Structure', key: 'fee_structure', width: 24 },
        { header: 'Concession Amount', key: 'concession_amount', width: 18 },
        { header: 'Settled', key: 'settled', width: 10 },
        { header: 'Settled Date', key: 'settled_date', width: 14 },
      ],
      rows: concessions.map((c) => {
        const mapping = c.fee_structures.student_fee_demand_mapping[0];
        return {
          student: mapping ? studentName(mapping.students.soa_applications) : '—',
          register_no: mapping?.students.register_no ?? '—',
          fee_structure: c.fee_structures.name,
          concession_amount: dec(c.concession_amount).toFixed(2),
          settled: c.is_settled ? 'Yes' : 'No',
          settled_date: c.settled_date ? c.settled_date.toISOString().slice(0, 10) : '—',
        };
      }),
    };
  }

  // ── 4. Education Loan DD Register ────────────────────────────────────────

  async buildEducationLoanDdRegisterTable(): Promise<ReportTable> {
    let dds;
    try {
      dds = await this.prisma.education_loan_dd.findMany({
        select: {
          dd_reference_number: true,
          bank_name: true,
          amount: true,
          status: true,
          acknowledgement_receipt_no: true,
          student_fee_demand_mapping: {
            select: {
              students: {
                select: {
                  register_no: true,
                  soa_applications: { select: { first_name: true, last_name: true } },
                },
              },
            },
          },
        },
        orderBy: { id: 'desc' },
      });
    } catch (err) {
      this.fail('education loan DD register report', err);
    }

    return {
      title: 'Education Loan DD Register',
      columns: [
        { header: 'Student', key: 'student', width: 22 },
        { header: 'Register No.', key: 'register_no', width: 16 },
        { header: 'DD Reference No.', key: 'dd_reference_number', width: 20 },
        { header: 'Bank', key: 'bank', width: 20 },
        { header: 'Amount', key: 'amount', width: 16 },
        { header: 'Status', key: 'status', width: 12 },
        { header: 'Ack. Receipt No.', key: 'ack_receipt_no', width: 18 },
      ],
      rows: dds.map((dd) => ({
        student: studentName(dd.student_fee_demand_mapping.students.soa_applications),
        register_no: dd.student_fee_demand_mapping.students.register_no ?? '—',
        dd_reference_number: dd.dd_reference_number,
        bank: dd.bank_name,
        amount: dec(dd.amount).toFixed(2),
        status: dd.status,
        ack_receipt_no: dd.acknowledgement_receipt_no ?? '—',
      })),
    };
  }

  // ── 6. Daily Collection Summary ──────────────────────────────────────────

  async buildDailyCollectionSummaryTable(): Promise<ReportTable> {
    let payments;
    try {
      payments = await this.prisma.fee_payments.findMany({
        select: { amount_paid: true, payment_date: true, payment_mode: true },
      });
    } catch (err) {
      this.fail('daily collection summary report', err);
    }

    const byDate = new Map<string, Record<string, Prisma.Decimal>>();
    for (const p of payments) {
      const date = p.payment_date.toISOString().slice(0, 10);
      const mode = p.payment_mode ?? 'unspecified';
      const row = byDate.get(date) ?? {};
      row[mode] = (row[mode] ?? new Prisma.Decimal(0)).plus(p.amount_paid);
      byDate.set(date, row);
    }

    const sortedDates = [...byDate.keys()].sort((a, b) => b.localeCompare(a));

    return {
      title: 'Daily Collection Summary',
      columns: [
        { header: 'Date', key: 'date', width: 14 },
        { header: 'Cash', key: 'cash', width: 14 },
        { header: 'Card', key: 'card', width: 14 },
        { header: 'UPI', key: 'upi', width: 14 },
        { header: 'Netbanking', key: 'netbanking', width: 14 },
        { header: 'DD', key: 'dd', width: 14 },
        { header: 'Razorpay', key: 'razorpay', width: 14 },
        { header: 'Total', key: 'total', width: 16 },
      ],
      rows: sortedDates.map((date) => {
        const modeAmounts = byDate.get(date)!;
        const total = MODE_COLUMNS.reduce(
          (sum, mode) => sum.plus(modeAmounts[mode] ?? new Prisma.Decimal(0)),
          new Prisma.Decimal(0),
        );
        const row: Record<string, string> = { date };
        for (const mode of MODE_COLUMNS) {
          row[mode] = (modeAmounts[mode] ?? new Prisma.Decimal(0)).toFixed(2);
        }
        row.total = total.toFixed(2);
        return row;
      }),
    };
  }

}
