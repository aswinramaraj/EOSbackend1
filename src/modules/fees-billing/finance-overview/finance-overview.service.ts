import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { Prisma } from '../../../../generated/prisma/client';
import {
  ConcessionSummaryDto,
  DepartmentOutstandingItemDto,
  EducationLoanDdSummaryDto,
  ExecutiveKpisDto,
  FinanceOverviewResponseDto,
  MonthlyCollectionTrendItemDto,
  PaymentStatusDistributionItemDto,
  RecentPaymentItemDto,
  TopOutstandingStudentItemDto,
} from './dto/finance-overview-response.dto';

type DueStatus = 'paid' | 'partial' | 'pending';

const RECENT_PAYMENTS_LIMIT = 10;
const TOP_OUTSTANDING_STUDENTS_LIMIT = 10;

function dueStatusOf(total: Prisma.Decimal, paid: Prisma.Decimal): DueStatus {
  if (paid.greaterThanOrEqualTo(total) && total.greaterThan(0)) return 'paid';
  if (paid.greaterThan(0)) return 'partial';
  return 'pending';
}

function clampNonNegative(value: Prisma.Decimal): Prisma.Decimal {
  return value.isNegative() ? new Prisma.Decimal(0) : value;
}

@Injectable()
export class FinanceOverviewService {
  private readonly logger = new Logger(FinanceOverviewService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * GET /finance-overview?batch=<batch name>
   *
   * One consistent read of the finance domain (student_fee_demand_mapping,
   * fee_structure_items, fee_payments, education_loan_dd, fee_concessions,
   * fee_structures) taken inside a single Prisma transaction, so every
   * number in the response is derived from the same database snapshot.
   *
   * total_amount per demand is computed live from fee_structure_items
   * (never from the student_fee_demand_mapping.total_amount snapshot column)
   * for the same reason it was fixed on the dashboard/workspace endpoints:
   * the snapshot can only be as fresh as whatever process last wrote it.
   *
   * batchName is optional — omitted (the "All" case) returns the exact same
   * everything-included aggregate this endpoint always returned. When
   * provided, every section (KPIs, all 4 charts, Recent Payments, Top
   * Outstanding Students, Concession/DD summaries) is recomputed scoped to
   * only the students in that batch — education_loan_dd and fee_concessions
   * are scoped the same way, via the demand mappings that survive the
   * batch filter (they have no direct batch column of their own).
   */
  async getOverview(batchName?: string): Promise<FinanceOverviewResponseDto> {
    let mappings: Awaited<ReturnType<typeof this.queryMappings>>;
    let educationLoanDds: Awaited<
      ReturnType<typeof this.queryEducationLoanDds>
    >;
    let concessions: Awaited<ReturnType<typeof this.queryConcessions>>;
    let activeFeeStructures: number;

    try {
      // Interactive transaction (not the array form used before) because the
      // concession scoping below depends on this run's own mapping results —
      // still one consistent snapshot, just sequenced instead of parallel.
      ({ mappings, educationLoanDds, concessions, activeFeeStructures } =
        await this.prisma.$transaction(
          async (tx) => {
            const mappingsResult = await this.queryMappings(tx, batchName);

            // education_loan_dd has no batch column of its own — scoped via
            // the same students→batches chain, independently of the mappings
            // above (identical filter, just its own query, since a DD isn't
            // reachable by walking the mappings' own relations here).
            const educationLoanDdsResult = await this.queryEducationLoanDds(
              tx,
              batchName,
            );

            // fee_concessions has no student/batch column either — it's
            // scoped via fee_structure_id, which even a single student can
            // share with others outside the selected batch. Restricting to
            // the fee_structure_ids actually used by this batch's own mappings
            // is the closest correct scoping without a schema change (same
            // known limitation already documented elsewhere: concessions are
            // structure-scoped, not student-scoped). Omitted entirely for
            // "All", so that case stays byte-identical to before.
            const structureIds = batchName
              ? [...new Set(mappingsResult.map((m) => m.fee_structure_id))]
              : undefined;
            const concessionsResult = await this.queryConcessions(
              tx,
              structureIds,
            );

            const activeFeeStructuresResult = await tx.fee_structures.count();

            return {
              mappings: mappingsResult,
              educationLoanDds: educationLoanDdsResult,
              concessions: concessionsResult,
              activeFeeStructures: activeFeeStructuresResult,
            };
          },
          // The 5s/2s defaults (timeout/maxWait) are too tight against the
          // current DB link (free-tier Supabase, cold-start/network latency
          // observed up to ~7s for a single query) — both raised so a
          // slow-but-healthy round trip doesn't get killed mid-transaction
          // or rejected before it even starts while waiting for a
          // connection to free up.
          { timeout: 20_000, maxWait: 20_000 },
        ));
    } catch (err) {
      this.logger.error('DB error while building finance overview', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }

    const perMapping = mappings.map((mapping) => {
      const totalAmount = mapping.fee_structures.fee_structure_items.reduce(
        (sum, item) => sum.plus(item.amount),
        new Prisma.Decimal(0),
      );
      const paidAmount = mapping.fee_payments.reduce(
        (sum, payment) => sum.plus(payment.amount_paid),
        new Prisma.Decimal(0),
      );
      const outstandingAmount = clampNonNegative(totalAmount.minus(paidAmount));

      return {
        mapping,
        totalAmount,
        paidAmount,
        outstandingAmount,
        dueStatus: dueStatusOf(totalAmount, paidAmount),
      };
    });

    return {
      executiveKPIs: this.buildExecutiveKpis(
        perMapping,
        educationLoanDds,
        activeFeeStructures,
      ),
      financialAnalytics: {
        demandVsCollection: this.buildDemandVsCollection(perMapping),
        monthlyCollectionTrend: this.buildMonthlyCollectionTrend(mappings),
        departmentOutstanding: this.buildDepartmentOutstanding(perMapping),
        paymentStatusDistribution:
          this.buildPaymentStatusDistribution(perMapping),
        collectionByPaymentMode: this.buildCollectionByPaymentMode(mappings),
      },
      operationalInsights: {
        recentPayments: this.buildRecentPayments(mappings),
        topOutstandingStudents: this.buildTopOutstandingStudents(perMapping),
        concessionSummary: this.buildConcessionSummary(concessions),
        educationLoanDDSummary:
          this.buildEducationLoanDdSummary(educationLoanDds),
      },
    };
  }

  private queryMappings(tx: Prisma.TransactionClient, batchName?: string) {
    return tx.student_fee_demand_mapping.findMany({
      where: batchName
        ? { students: { batches: { name: batchName } } }
        : undefined,
      select: {
        id: true,
        student_id: true,
        fee_structure_id: true,
        fee_payments: {
          select: {
            id: true,
            amount_paid: true,
            payment_date: true,
            payment_mode: true,
            receipt_no: true,
          },
        },
        fee_structures: {
          select: {
            fee_structure_items: { select: { amount: true } },
          },
        },
        students: {
          select: {
            id: true,
            register_no: true,
            soa_applications: {
              select: { first_name: true, last_name: true },
            },
            courses: {
              select: { departments: { select: { name: true } } },
            },
          },
        },
      },
    });
  }

  private queryEducationLoanDds(
    tx: Prisma.TransactionClient,
    batchName?: string,
  ) {
    return tx.education_loan_dd.findMany({
      where: batchName
        ? {
            student_fee_demand_mapping: {
              students: { batches: { name: batchName } },
            },
          }
        : undefined,
      select: { amount: true, status: true },
    });
  }

  private queryConcessions(
    tx: Prisma.TransactionClient,
    feeStructureIds?: number[],
  ) {
    return tx.fee_concessions.findMany({
      where: feeStructureIds
        ? { fee_structure_id: { in: feeStructureIds } }
        : undefined,
      select: { concession_amount: true, is_settled: true },
    });
  }

  /**
   * GET /finance-overview/batches
   *
   * Real batches that actually have at least one student with a fee demand
   * mapping — never a hardcoded/guessed list. "All" is the frontend's own
   * default option (no batch param sent); this endpoint only returns the
   * real per-batch options alongside it.
   */
  async getAvailableBatches(): Promise<string[]> {
    let batches: { name: string }[];

    try {
      batches = await this.prisma.batches.findMany({
        where: {
          students: { some: { student_fee_demand_mapping: { some: {} } } },
        },
        select: { name: true },
        orderBy: { name: 'asc' },
      });
    } catch (err) {
      this.logger.error('DB error while fetching available batches', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }

    return batches.map((batch) => batch.name);
  }

  private buildExecutiveKpis(
    perMapping: {
      totalAmount: Prisma.Decimal;
      paidAmount: Prisma.Decimal;
      outstandingAmount: Prisma.Decimal;
    }[],
    educationLoanDds: { status: string }[],
    activeFeeStructures: number,
  ): ExecutiveKpisDto {
    const totalFeeDemand = perMapping.reduce(
      (sum, m) => sum.plus(m.totalAmount),
      new Prisma.Decimal(0),
    );
    const totalCollected = perMapping.reduce(
      (sum, m) => sum.plus(m.paidAmount),
      new Prisma.Decimal(0),
    );
    const totalOutstanding = perMapping.reduce(
      (sum, m) => sum.plus(m.outstandingAmount),
      new Prisma.Decimal(0),
    );

    const collectionPercentage = totalFeeDemand.greaterThan(0)
      ? totalCollected
          .dividedBy(totalFeeDemand)
          .times(100)
          .toDecimalPlaces(2)
          .toNumber()
      : 0;

    const pendingEducationLoanDD = educationLoanDds.filter(
      (dd) => dd.status === 'received',
    ).length;

    return {
      totalFeeDemand: totalFeeDemand.toString(),
      totalCollected: totalCollected.toString(),
      totalOutstanding: totalOutstanding.toString(),
      collectionPercentage,
      pendingEducationLoanDD,
      activeFeeStructures,
    };
  }

  private buildDemandVsCollection(
    perMapping: {
      totalAmount: Prisma.Decimal;
      paidAmount: Prisma.Decimal;
      outstandingAmount: Prisma.Decimal;
    }[],
  ) {
    const totalDemand = perMapping.reduce(
      (sum, m) => sum.plus(m.totalAmount),
      new Prisma.Decimal(0),
    );
    const totalCollected = perMapping.reduce(
      (sum, m) => sum.plus(m.paidAmount),
      new Prisma.Decimal(0),
    );
    const totalOutstanding = perMapping.reduce(
      (sum, m) => sum.plus(m.outstandingAmount),
      new Prisma.Decimal(0),
    );

    return {
      totalDemand: totalDemand.toString(),
      totalCollected: totalCollected.toString(),
      totalOutstanding: totalOutstanding.toString(),
    };
  }

  private buildMonthlyCollectionTrend(
    mappings: Awaited<ReturnType<typeof this.queryMappings>>,
  ): MonthlyCollectionTrendItemDto[] {
    const totalsByMonth = new Map<string, Prisma.Decimal>();

    for (const mapping of mappings) {
      for (const payment of mapping.fee_payments) {
        const month = payment.payment_date.toISOString().slice(0, 7); // YYYY-MM
        const running = totalsByMonth.get(month) ?? new Prisma.Decimal(0);
        totalsByMonth.set(month, running.plus(payment.amount_paid));
      }
    }

    return [...totalsByMonth.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, totalCollected]) => ({
        month,
        totalCollected: totalCollected.toString(),
      }));
  }

  private buildDepartmentOutstanding(
    perMapping: {
      mapping: Awaited<ReturnType<typeof this.queryMappings>>[number];
      totalAmount: Prisma.Decimal;
      outstandingAmount: Prisma.Decimal;
    }[],
  ): DepartmentOutstandingItemDto[] {
    const totalsByDepartment = new Map<
      string,
      { totalDemand: Prisma.Decimal; totalOutstanding: Prisma.Decimal }
    >();

    for (const { mapping, totalAmount, outstandingAmount } of perMapping) {
      const department = mapping.students.courses.departments.name;
      const running = totalsByDepartment.get(department) ?? {
        totalDemand: new Prisma.Decimal(0),
        totalOutstanding: new Prisma.Decimal(0),
      };

      totalsByDepartment.set(department, {
        totalDemand: running.totalDemand.plus(totalAmount),
        totalOutstanding: running.totalOutstanding.plus(outstandingAmount),
      });
    }

    return [...totalsByDepartment.entries()]
      .map(([department, totals]) => ({
        department,
        totalDemand: totals.totalDemand.toString(),
        totalOutstanding: totals.totalOutstanding.toString(),
      }))
      .sort((a, b) => Number(b.totalOutstanding) - Number(a.totalOutstanding));
  }

  private buildPaymentStatusDistribution(
    perMapping: { dueStatus: DueStatus }[],
  ): PaymentStatusDistributionItemDto[] {
    const counts: Record<DueStatus, number> = {
      paid: 0,
      partial: 0,
      pending: 0,
    };

    for (const { dueStatus } of perMapping) {
      counts[dueStatus] += 1;
    }

    return (['paid', 'partial', 'pending'] as DueStatus[]).map((status) => ({
      status,
      count: counts[status],
    }));
  }

  /**
   * Real per-payment-mode composition of every fee_payments row in scope —
   * mode names are the actual payment_mode_enum values (cash/card/upi/dd/
   * netbanking); a null mode (legacy rows recorded before this field
   * existed) is grouped under "unspecified" rather than dropped or guessed.
   */
  private buildCollectionByPaymentMode(
    mappings: Awaited<ReturnType<typeof this.queryMappings>>,
  ): { mode: string; totalAmount: string; count: number }[] {
    const totals = new Map<string, { amount: Prisma.Decimal; count: number }>();

    for (const mapping of mappings) {
      for (const payment of mapping.fee_payments) {
        const mode = payment.payment_mode ?? 'unspecified';
        const entry = totals.get(mode) ?? { amount: new Prisma.Decimal(0), count: 0 };
        entry.amount = entry.amount.plus(payment.amount_paid);
        entry.count += 1;
        totals.set(mode, entry);
      }
    }

    return [...totals.entries()]
      .map(([mode, { amount, count }]) => ({
        mode,
        totalAmount: amount.toString(),
        count,
      }))
      .sort((a, b) => Number(b.totalAmount) - Number(a.totalAmount));
  }

  private buildRecentPayments(
    mappings: Awaited<ReturnType<typeof this.queryMappings>>,
  ): RecentPaymentItemDto[] {
    return mappings
      .flatMap((mapping) => {
        const studentName = mapping.students.soa_applications
          ? [
              mapping.students.soa_applications.first_name,
              mapping.students.soa_applications.last_name,
            ]
              .filter(Boolean)
              .join(' ')
          : null;

        return mapping.fee_payments.map((payment) => ({
          id: payment.id,
          student_id: mapping.student_id,
          student_name: studentName,
          amount_paid: payment.amount_paid.toString(),
          payment_date: payment.payment_date,
          payment_mode: payment.payment_mode,
          receipt_no: payment.receipt_no,
        }));
      })
      .sort((a, b) => b.payment_date.getTime() - a.payment_date.getTime())
      .slice(0, RECENT_PAYMENTS_LIMIT);
  }

  private buildTopOutstandingStudents(
    perMapping: {
      mapping: Awaited<ReturnType<typeof this.queryMappings>>[number];
      outstandingAmount: Prisma.Decimal;
    }[],
  ): TopOutstandingStudentItemDto[] {
    const totalsByStudent = new Map<
      number,
      {
        student_name: string | null;
        register_number: string | null;
        totalOutstanding: Prisma.Decimal;
      }
    >();

    for (const { mapping, outstandingAmount } of perMapping) {
      const studentId = mapping.student_id;
      const studentName = mapping.students.soa_applications
        ? [
            mapping.students.soa_applications.first_name,
            mapping.students.soa_applications.last_name,
          ]
            .filter(Boolean)
            .join(' ')
        : null;

      const running = totalsByStudent.get(studentId) ?? {
        student_name: studentName,
        register_number: mapping.students.register_no,
        totalOutstanding: new Prisma.Decimal(0),
      };

      totalsByStudent.set(studentId, {
        ...running,
        totalOutstanding: running.totalOutstanding.plus(outstandingAmount),
      });
    }

    return [...totalsByStudent.entries()]
      .map(([student_id, data]) => ({
        student_id,
        student_name: data.student_name,
        register_number: data.register_number,
        total_outstanding: data.totalOutstanding.toString(),
      }))
      .filter((entry) => Number(entry.total_outstanding) > 0)
      .sort((a, b) => Number(b.total_outstanding) - Number(a.total_outstanding))
      .slice(0, TOP_OUTSTANDING_STUDENTS_LIMIT);
  }

  private buildConcessionSummary(
    concessions: { concession_amount: Prisma.Decimal; is_settled: boolean }[],
  ): ConcessionSummaryDto {
    const totalConcessionAmount = concessions.reduce(
      (sum, c) => sum.plus(c.concession_amount),
      new Prisma.Decimal(0),
    );

    return {
      total_concession_amount: totalConcessionAmount.toString(),
      count: concessions.length,
      settled_count: concessions.filter((c) => c.is_settled).length,
      unsettled_count: concessions.filter((c) => !c.is_settled).length,
    };
  }

  private buildEducationLoanDdSummary(
    educationLoanDds: { amount: Prisma.Decimal; status: string }[],
  ): EducationLoanDdSummaryDto {
    const totalAmount = educationLoanDds.reduce(
      (sum, dd) => sum.plus(dd.amount),
      new Prisma.Decimal(0),
    );

    return {
      total_amount: totalAmount.toString(),
      count: educationLoanDds.length,
      received_count: educationLoanDds.filter((dd) => dd.status === 'received')
        .length,
      cleared_count: educationLoanDds.filter((dd) => dd.status === 'cleared')
        .length,
      bounced_count: educationLoanDds.filter((dd) => dd.status === 'bounced')
        .length,
    };
  }
}
