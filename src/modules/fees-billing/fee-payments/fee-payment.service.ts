import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import * as crypto from 'crypto';
import Razorpay from 'razorpay';
import { PrismaService } from 'src/prisma/prisma.service';
import { NotificationsService } from 'src/modules/notifications/notifications/notifications.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { Prisma } from '../../../../generated/prisma/client';
import { CreateFeePaymentDto } from './dto/create-fee-payment.dto';
import { UpdateFeePaymentDto } from './dto/update-fee-payment.dto';
import { CreateFeePaymentOrderDto } from './dto/create-fee-payment-order.dto';
import { VerifyFeePaymentDto } from './dto/verify-fee-payment.dto';
import { FeePaymentDashboardRowDto } from './dto/fee-payment-dashboard-row.dto';
import {
  FeePaymentStudentWorkspaceDto,
  DemandSummaryItemDto,
} from './dto/fee-payment-student-workspace.dto';
import { CategoryBreakdownItemDto } from './dto/fee-payment-category-breakdown.dto';
import { IssueReceiptNumberDto } from './dto/issue-receipt-number.dto';

type DueStatus = 'paid' | 'partial' | 'pending';

function computeDueStatus(
  totalDemand: Prisma.Decimal,
  paidAmount: Prisma.Decimal,
): DueStatus {
  if (
    paidAmount.greaterThanOrEqualTo(totalDemand) &&
    totalDemand.greaterThan(0)
  ) {
    return 'paid';
  }
  if (paidAmount.greaterThan(0)) {
    return 'partial';
  }
  return 'pending';
}

/**
 * outstanding = total_amount - SUM(fee_payments.amount_paid), never negative —
 * a fee structure item edit can shrink total_amount below what was already
 * paid, and outstanding must clamp to 0 rather than go negative.
 */
function computeOutstanding(
  totalAmount: Prisma.Decimal,
  paidAmount: Prisma.Decimal,
): Prisma.Decimal {
  const outstanding = totalAmount.minus(paidAmount);
  return outstanding.isNegative() ? new Prisma.Decimal(0) : outstanding;
}

@Injectable()
export class FeePaymentService {
  private readonly logger = new Logger(FeePaymentService.name);
  private razorpay: Razorpay | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly auditLog: AuditLogService,
  ) {}

  private getRazorpay(): Razorpay {
    if (!this.razorpay) {
      const key_id = process.env.RAZORPAY_KEY_ID;
      const key_secret = process.env.RAZORPAY_KEY_SECRET;
      if (!key_id || !key_secret) {
        throw new InternalServerErrorException({
          message: 'Razorpay is not configured',
          errorCode: 'RAZORPAY_NOT_CONFIGURED',
        });
      }
      this.razorpay = new Razorpay({ key_id, key_secret });
    }
    return this.razorpay;
  }

  /**
   * GET /fee-payments
   */
  /**
   * GET /fee-payments — real, enriched with student/category context
   * (name, register no., department, demand category, fee structure)
   * for the Billing Portal's Receipts and Payment History screens.
   * Previously returned bare `fee_payments` rows with no joins at all —
   * purely additive enrichment, existing consumers only gain fields.
   */
  async findAll() {
    try {
      const rows = await this.prisma.fee_payments.findMany({
        orderBy: [{ payment_date: 'desc' }, { id: 'desc' }],
        include: {
          fee_structure_items: {
            include: {
              demand_categories: true,
              fee_structures: true,
            },
          },
          student_fee_demand_mapping: {
            include: {
              students: {
                include: {
                  soa_applications: true,
                  courses: { include: { departments: true } },
                },
              },
            },
          },
        },
      });
      return rows.map((p) => {
        const student = p.student_fee_demand_mapping.students;
        const studentName = student.soa_applications
          ? [student.soa_applications.first_name, student.soa_applications.last_name].filter(Boolean).join(' ')
          : null;
        return {
          id: p.id,
          student_fee_demand_mapping_id: p.student_fee_demand_mapping_id,
          student_id: student.id,
          student_name: studentName,
          register_number: student.register_no,
          department: student.courses.departments.name,
          demand_category_name: p.fee_structure_items?.demand_categories?.name ?? null,
          fee_structure_name: p.fee_structure_items?.fee_structures.name ?? null,
          amount_paid: p.amount_paid.toString(),
          payment_date: p.payment_date,
          payment_mode: p.payment_mode,
          receipt_no: p.receipt_no,
          is_partial: p.is_partial,
        };
      });
    } catch (err) {
      this.logger.error('DB error while fetching fee payments', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * GET /fee-payments/:id
   *
   * Error cases:
   *  404 FEE_PAYMENT_NOT_FOUND – no payment with the given id
   */
  async findOne(id: number) {
    const payment = await this.findById(id);

    if (!payment) {
      throw new NotFoundException({
        message: 'Fee payment not found',
        errorCode: 'FEE_PAYMENT_NOT_FOUND',
      });
    }

    return payment;
  }

  /**
   * GET /student-fee-demand-mappings/:id/payments
   *
   * Payment History — every field returned exactly as before, with one
   * additive field: demand_category_name, resolved via the existing
   * fee_payments.fee_structure_item_id → fee_structure_items →
   * demand_categories relations (no new column, no duplicated data).
   *
   * Historical rows with fee_structure_item_id = NULL simply have no
   * fee_structure_items relation to join through, so they resolve to
   * demand_category_name: null — they are not excluded or altered.
   *
   * Error cases:
   *  404 STUDENT_FEE_DEMAND_NOT_FOUND – no demand mapping with the given id
   */
  async findAllForDemandMapping(demandMappingId: number) {
    await this.assertDemandMappingExists(demandMappingId);

    try {
      const payments = await this.prisma.fee_payments.findMany({
        where: { student_fee_demand_mapping_id: demandMappingId },
        include: {
          fee_structure_items: { include: { demand_categories: true } },
        },
        orderBy: { id: 'asc' },
      });

      return payments.map(({ fee_structure_items, ...payment }) => ({
        ...payment,
        demand_category_name:
          fee_structure_items?.demand_categories?.name ?? 'General',
      }));
    } catch (err) {
      this.logger.error('DB error while fetching fee payments', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * GET /student-fee-demand-mappings/:id/category-breakdown
   *
   * One row per demand category (fee_structure_item) belonging to this
   * mapping's fee structure — Original Amount, Already Paid, Outstanding,
   * Status. Read-only; no data is modified.
   *
   * Already Paid / Outstanding are always scoped by BOTH
   * student_fee_demand_mapping_id AND fee_structure_item_id — never by
   * fee_structure_item_id alone — because the same fee_structure_items row
   * (and therefore the same fee_structure_item_id) is shared by every
   * student mapped to that fee structure. Filtering by item id alone would
   * sum other students' payments into this student's breakdown. This
   * method only ever reads fee_payments through this one mapping's own
   * `fee_payments` relation, which is inherently pre-scoped to
   * student_fee_demand_mapping_id — so grouping those rows by
   * fee_structure_item_id below is safe and never crosses mappings.
   *
   * Error cases:
   *  404 STUDENT_FEE_DEMAND_NOT_FOUND – no demand mapping with the given id
   */
  async getCategoryBreakdown(
    demandMappingId: number,
  ): Promise<CategoryBreakdownItemDto[]> {
    let mapping: Awaited<
      ReturnType<typeof this.findMappingWithCategoryBreakdownRelations>
    >;

    try {
      mapping =
        await this.findMappingWithCategoryBreakdownRelations(demandMappingId);
    } catch (err) {
      this.logger.error(
        'DB error while fetching fee structure category breakdown',
        err,
      );
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }

    if (!mapping) {
      throw new NotFoundException({
        message: 'Student fee demand mapping not found',
        errorCode: 'STUDENT_FEE_DEMAND_NOT_FOUND',
      });
    }

    return mapping.fee_structures.fee_structure_items.map((item) => {
      // mapping.fee_payments is already scoped to this one
      // student_fee_demand_mapping_id via the relation it was loaded
      // through — filtering by item.id here adds the fee_structure_item_id
      // half of the required two-column scope, never the only one.
      const alreadyPaid = mapping.fee_payments
        .filter((payment) => payment.fee_structure_item_id === item.id)
        .reduce(
          (sum, payment) => sum.plus(payment.amount_paid),
          new Prisma.Decimal(0),
        );

      const outstanding = computeOutstanding(item.amount, alreadyPaid);

      return {
        fee_structure_item_id: item.id,
        demand_category_name: item.demand_categories?.name ?? null,
        original_amount: item.amount.toString(),
        already_paid: alreadyPaid.toString(),
        outstanding_amount: outstanding.toString(),
        status: computeDueStatus(item.amount, alreadyPaid),
      };
    });
  }

  private async findMappingWithCategoryBreakdownRelations(
    demandMappingId: number,
  ) {
    return this.prisma.student_fee_demand_mapping.findUnique({
      where: { id: demandMappingId },
      select: {
        fee_payments: {
          select: { fee_structure_item_id: true, amount_paid: true },
        },
        fee_structures: {
          select: {
            fee_structure_items: {
              select: {
                id: true,
                amount: true,
                demand_categories: { select: { name: true } },
              },
            },
          },
        },
      },
    });
  }

  /**
   * GET /fee-payments/dashboard
   *
   * One row per student fee demand mapping, with the demand's payment
   * status rolled up from fee_payments.
   */
  async dashboard(): Promise<FeePaymentDashboardRowDto[]> {
    let mappings: Awaited<
      ReturnType<typeof this.findDemandMappingsWithDashboardRelations>
    >;

    try {
      mappings = await this.findDemandMappingsWithDashboardRelations();
    } catch (err) {
      this.logger.error('DB error while fetching fee payments dashboard', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }

    return mappings.map((mapping) => {
      const liveTotalAmount = this.computeLiveTotalAmount(
        mapping.fee_structures.fee_structure_items,
      );
      const paidAmount = mapping.fee_payments.reduce(
        (sum, payment) => sum.plus(payment.amount_paid),
        new Prisma.Decimal(0),
      );
      const lastPaymentDate = mapping.fee_payments.reduce<Date | null>(
        (latest, payment) =>
          !latest || payment.payment_date > latest
            ? payment.payment_date
            : latest,
        null,
      );
      const studentName = mapping.students.soa_applications
        ? [
            mapping.students.soa_applications.first_name,
            mapping.students.soa_applications.last_name,
          ]
            .filter(Boolean)
            .join(' ')
        : null;

      return {
        student_fee_demand_mapping_id: mapping.id,
        student_id: mapping.student_id,
        student_name: studentName,
        register_number: mapping.students.register_no,
        programme: mapping.students.courses.name,
        department: mapping.students.courses.departments.name,
        batch: mapping.students.batches.name,
        quota: mapping.students.quotas.name,
        class_id: mapping.students.class_id,
        fee_structure_name: mapping.fee_structures.name,
        academic_year: mapping.academic_year,
        total_demand: liveTotalAmount.toString(),
        paid_amount: paidAmount.toString(),
        outstanding_amount: computeOutstanding(
          liveTotalAmount,
          paidAmount,
        ).toString(),
        due_status: computeDueStatus(liveTotalAmount, paidAmount),
        last_payment_date: lastPaymentDate,
      };
    });
  }

  /**
   * GET /fee-payments/students/:studentId/workspace
   *
   * Error cases:
   *  404 STUDENT_NOT_FOUND – no student with the given id
   */
  async getStudentWorkspace(
    studentId: number,
  ): Promise<FeePaymentStudentWorkspaceDto> {
    let student: Awaited<
      ReturnType<typeof this.findStudentWithWorkspaceRelations>
    >;

    try {
      student = await this.findStudentWithWorkspaceRelations(studentId);
    } catch (err) {
      this.logger.error('DB error during student workspace lookup', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }

    if (!student) {
      throw new NotFoundException({
        message: 'Student not found',
        errorCode: 'STUDENT_NOT_FOUND',
      });
    }

    const demandMappings = student.student_fee_demand_mapping;

    const demandSummary: DemandSummaryItemDto[] = demandMappings.map(
      (mapping) => {
        const liveTotalAmount = this.computeLiveTotalAmount(
          mapping.fee_structures.fee_structure_items,
        );
        const paidAmount = mapping.fee_payments.reduce(
          (sum, payment) => sum.plus(payment.amount_paid),
          new Prisma.Decimal(0),
        );

        // TRACE — temporary, requested for live debugging of demand_summary.total_amount.
        this.logger.debug(
          `[workspace-trace] mapping.id=${mapping.id} ` +
            `fee_structure_id=${mapping.fee_structure_id} ` +
            `snapshot_total_amount=${mapping.total_amount.toString()} ` +
            `fee_structure_items=${JSON.stringify(mapping.fee_structures.fee_structure_items.map((i) => ({ id: i.id, amount: i.amount.toString() })))} ` +
            `live_sum=${liveTotalAmount.toString()} ` +
            `assigned_total_amount=${liveTotalAmount.toString()}`,
        );

        return {
          student_fee_demand_mapping_id: mapping.id,
          fee_structure_id: mapping.fee_structure_id,
          fee_structure_name: mapping.fee_structures.name,
          applies_to: mapping.fee_structures.applies_to,
          academic_year: mapping.academic_year,
          semester: mapping.semester,
          total_amount: liveTotalAmount.toString(),
          paid_amount: paidAmount.toString(),
          outstanding_amount: computeOutstanding(
            liveTotalAmount,
            paidAmount,
          ).toString(),
          due_status: computeDueStatus(liveTotalAmount, paidAmount),
        };
      },
    );

    const totalDemand = demandMappings.reduce(
      (sum, mapping) =>
        sum.plus(
          this.computeLiveTotalAmount(
            mapping.fee_structures.fee_structure_items,
          ),
        ),
      new Prisma.Decimal(0),
    );
    const totalPaid = demandMappings.reduce(
      (sum, mapping) =>
        sum.plus(
          mapping.fee_payments.reduce(
            (s, payment) => s.plus(payment.amount_paid),
            new Prisma.Decimal(0),
          ),
        ),
      new Prisma.Decimal(0),
    );

    const paymentHistory = demandMappings
      .flatMap((mapping) =>
        mapping.fee_payments.map((payment) => ({
          id: payment.id,
          student_fee_demand_mapping_id: mapping.id,
          amount_paid: payment.amount_paid.toString(),
          payment_date: payment.payment_date,
          payment_mode: payment.payment_mode,
          receipt_no: payment.receipt_no,
          is_partial: payment.is_partial,
          collected_by_user_id: payment.collected_by_user_id,
        })),
      )
      .sort((a, b) => b.payment_date.getTime() - a.payment_date.getTime());

    const lastPaymentDate = paymentHistory[0]?.payment_date ?? null;

    const feeConcessions = demandMappings
      .flatMap((mapping) =>
        mapping.fee_structures.fee_concessions.map((concession) => ({
          id: concession.id,
          fee_structure_id: mapping.fee_structure_id,
          fee_structure_name: mapping.fee_structures.name,
          concession_amount: concession.concession_amount.toString(),
          is_settled: concession.is_settled,
          settled_date: concession.settled_date,
        })),
      )
      .filter(
        (concession, index, all) =>
          all.findIndex((c) => c.id === concession.id) === index,
      );

    const educationLoanDd = demandMappings.flatMap((mapping) =>
      mapping.education_loan_dd.map((loan) => ({
        id: loan.id,
        student_fee_demand_mapping_id: mapping.id,
        dd_reference_number: loan.dd_reference_number,
        bank_name: loan.bank_name,
        amount: loan.amount.toString(),
        status: loan.status,
        acknowledgement_receipt_no: loan.acknowledgement_receipt_no,
        received_by_user_id: loan.received_by_user_id,
      })),
    );

    const studentName = student.soa_applications
      ? [
          student.soa_applications.first_name,
          student.soa_applications.last_name,
        ]
          .filter(Boolean)
          .join(' ')
      : null;

    return {
      student_profile: {
        student_id: student.id,
        student_name: studentName,
        register_number: student.register_no,
        roll_no: student.roll_no,
        admission_no: student.admission_no,
        student_id_no: student.student_id_no,
        programme: student.courses.name,
        department: student.courses.departments.name,
        batch: student.batches.name,
        quota: student.quotas.name,
        gender: student.gender,
        status: student.status,
      },
      fee_summary: {
        total_demand: totalDemand.toString(),
        total_paid: totalPaid.toString(),
        total_outstanding: computeOutstanding(
          totalDemand,
          totalPaid,
        ).toString(),
        due_status: computeDueStatus(totalDemand, totalPaid),
      },
      demand_summary: demandSummary,
      payment_summary: {
        payment_count: paymentHistory.length,
        total_paid: totalPaid.toString(),
        last_payment_date: lastPaymentDate,
      },
      payment_history: paymentHistory,
      fee_concessions: feeConcessions,
      education_loan_dd: educationLoanDd,
    };
  }

  private async findDemandMappingsWithDashboardRelations() {
    return this.prisma.student_fee_demand_mapping.findMany({
      include: {
        fee_payments: true,
        fee_structures: { include: { fee_structure_items: true } },
        students: {
          include: {
            soa_applications: true,
            batches: true,
            courses: { include: { departments: true } },
            quotas: true,
          },
        },
      },
      orderBy: [{ student_id: 'asc' }, { id: 'asc' }],
    });
  }

  private async findStudentWithWorkspaceRelations(studentId: number) {
    return this.prisma.students.findUnique({
      where: { id: studentId },
      include: {
        soa_applications: true,
        batches: true,
        quotas: true,
        courses: { include: { departments: true } },
        student_fee_demand_mapping: {
          include: {
            fee_payments: { orderBy: { payment_date: 'desc' } },
            education_loan_dd: true,
            fee_structures: {
              include: { fee_concessions: true, fee_structure_items: true },
            },
          },
        },
      },
    });
  }

  /**
   * Live source-of-truth for a demand's total, read directly from
   * fee_structure_items on every call — NOT the stored
   * student_fee_demand_mapping.total_amount snapshot.
   *
   * total_amount on student_fee_demand_mapping is kept in sync by
   * FeeStructureItemService whenever an item is created/updated/deleted, but
   * that snapshot can only ever be as fresh as that write path — any gap
   * there (a bypassed write path, a process that hasn't picked up the sync
   * code, a direct DB edit) would make total_amount stale. Computing it here
   * from fee_structure_items directly removes that dependency entirely: the
   * dashboard and workspace endpoints can never show a total that disagrees
   * with the fee structure's actual items, regardless of the snapshot's state.
   */
  private computeLiveTotalAmount(
    feeStructureItems: { amount: Prisma.Decimal }[],
  ) {
    return feeStructureItems.reduce(
      (sum, item) => sum.plus(item.amount),
      new Prisma.Decimal(0),
    );
  }

  /**
   * POST /student-fee-demand-mappings/:id/payments
   *
   * Category-wise payment: dto.fee_structure_item_id selects exactly which
   * demand category (Academic Fee, Exam Fee, ...) this payment is for.
   * Already Paid / Outstanding for that category are always computed
   * scoped by BOTH student_fee_demand_mapping_id AND fee_structure_item_id
   * together — never by fee_structure_item_id alone, since the same
   * fee_structure_items row is shared by every student on that fee
   * structure; filtering by item id alone would sum other students'
   * payments into this one.
   *
   * The existence check, the mismatch check, the already-paid aggregate,
   * and the insert all run inside one $transaction so that two concurrent
   * requests against the same category cannot both read a stale
   * "outstanding" value and jointly overpay it.
   *
   * Error cases:
   *  404 STUDENT_FEE_DEMAND_NOT_FOUND     – no demand mapping with the given id
   *  404 FEE_STRUCTURE_ITEM_NOT_FOUND     – fee_structure_item_id does not exist
   *  422 FEE_STRUCTURE_ITEM_MISMATCH      – fee_structure_item_id belongs to a
   *                                          different fee structure than this mapping
   *  409 FEE_PAYMENT_RECEIPT_EXISTS       – receipt_no already used by another payment
   *  422 DEMAND_CATEGORY_ALREADY_SETTLED  – this category's outstanding is already 0
   *  422 PAYMENT_EXCEEDS_DUE_AMOUNT       – amount_paid would exceed this category's outstanding
   *
   * collectedByUserId is always the authenticated caller's id (from the JWT) —
   * the client cannot set who collected a payment.
   */
  async create(
    demandMappingId: number,
    dto: CreateFeePaymentDto,
    collectedByUserId: number,
  ) {
    const MAX_SERIALIZATION_RETRIES = 3;

    for (let attempt = 1; attempt <= MAX_SERIALIZATION_RETRIES; attempt++) {
      try {
        const payment = await this.createWithinTransaction(
          demandMappingId,
          dto,
          collectedByUserId,
        );
        await this.notifyPaymentConfirmed(demandMappingId, payment);
        await this.auditLog.record({
          entity_type: 'fee_payment',
          entity_id: payment.id,
          action: 'created',
          performed_by_user_id: collectedByUserId,
          new_value: {
            receipt_no: payment.receipt_no,
            amount_paid: payment.amount_paid.toString(),
            payment_mode: payment.payment_mode,
            student_fee_demand_mapping_id: demandMappingId,
          },
        });
        return payment;
      } catch (err) {
        const isSerializationConflict =
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2034';

        // P2002 on receipt_no: two concurrent requests both computed the
        // same "next" auto-generated receipt number before either had
        // committed. The unique constraint on receipt_no is the safety net
        // behind the SERIALIZABLE isolation above — retry re-reads the
        // now-committed max and generates the true next number.
        const isReceiptNumberRace =
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2002' &&
          (err.meta?.target as string[] | undefined)?.includes('receipt_no');

        const isRetryableConflict =
          isSerializationConflict || isReceiptNumberRace;

        if (isRetryableConflict && attempt < MAX_SERIALIZATION_RETRIES) {
          // Two concurrent requests raced for the same demand category (or
          // the same next receipt number) under SERIALIZABLE isolation —
          // Postgres aborted this one to preserve correctness. Retry: the
          // other request has now committed, so this retry re-reads
          // up-to-date state and is validated against reality, not a stale
          // snapshot.
          continue;
        }

        if (isRetryableConflict) {
          throw new ConflictException({
            message:
              'This payment could not be completed due to a concurrent update. Please try again.',
            errorCode: 'CONCURRENT_PAYMENT_CONFLICT',
          });
        }

        if (
          err instanceof NotFoundException ||
          err instanceof ConflictException ||
          err instanceof UnprocessableEntityException
        ) {
          throw err;
        }

        this.logger.error('DB error while creating fee payment', err);
        throw new InternalServerErrorException({
          message: 'Something went wrong. Please try again.',
          errorCode: 'INTERNAL_ERROR',
        });
      }
    }
  }

  /**
   * Runs after createWithinTransaction has already committed - never
   * throws, and never rolls back a payment that has already succeeded
   * just because notifying the student failed.
   */
  private async notifyPaymentConfirmed(
    demandMappingId: number,
    payment: { id: number; amount_paid: Prisma.Decimal; receipt_no: string },
  ): Promise<void> {
    try {
      const mapping = await this.prisma.student_fee_demand_mapping.findUnique({
        where: { id: demandMappingId },
        select: { student_id: true },
      });
      if (!mapping) return;

      const student = await this.prisma.students.findUnique({
        where: { id: mapping.student_id },
        select: { user_id: true },
      });
      if (!student) return;

      await this.notifications.notify({
        user_id: student.user_id,
        title: 'Fee payment confirmed',
        message: `Your payment of ₹${payment.amount_paid.toString()} (receipt ${payment.receipt_no}) has been recorded.`,
        type: 'fee_payment_confirmed',
        related_entity_type: 'fee_payment',
        related_entity_id: payment.id,
      });
    } catch (err) {
      this.logger.error(
        `Failed to notify student of fee payment ${payment.id}`,
        err,
      );
    }
  }

  private async createWithinTransaction(
    demandMappingId: number,
    dto: CreateFeePaymentDto,
    collectedByUserId: number,
  ) {
    return this.prisma.$transaction(
      async (tx) => {
        const mapping = await tx.student_fee_demand_mapping.findUnique({
          where: { id: demandMappingId },
          select: { fee_structure_id: true },
        });

        if (!mapping) {
          throw new NotFoundException({
            message: 'Student fee demand mapping not found',
            errorCode: 'STUDENT_FEE_DEMAND_NOT_FOUND',
          });
        }

        const item = await tx.fee_structure_items.findUnique({
          where: { id: dto.fee_structure_item_id },
          select: { id: true, fee_structure_id: true, amount: true },
        });

        if (!item) {
          throw new NotFoundException({
            message: 'Fee structure item not found',
            errorCode: 'FEE_STRUCTURE_ITEM_NOT_FOUND',
          });
        }

        if (item.fee_structure_id !== mapping.fee_structure_id) {
          throw new UnprocessableEntityException({
            message:
              'This fee structure item does not belong to the selected student fee demand mapping',
            errorCode: 'FEE_STRUCTURE_ITEM_MISMATCH',
          });
        }

        const receiptNo = await this.generateNextReceiptNo(tx);

        // Scoped by BOTH student_fee_demand_mapping_id AND
        // fee_structure_item_id — never by fee_structure_item_id alone.
        const paidSoFarResult = await tx.fee_payments.aggregate({
          where: {
            student_fee_demand_mapping_id: demandMappingId,
            fee_structure_item_id: item.id,
          },
          _sum: { amount_paid: true },
        });
        const alreadyPaid =
          paidSoFarResult._sum.amount_paid ?? new Prisma.Decimal(0);

        const outstanding = computeOutstanding(item.amount, alreadyPaid);

        if (outstanding.lessThanOrEqualTo(0)) {
          throw new UnprocessableEntityException({
            message: 'This demand category has already been fully paid',
            errorCode: 'DEMAND_CATEGORY_ALREADY_SETTLED',
          });
        }

        if (new Prisma.Decimal(dto.amount_paid).greaterThan(outstanding)) {
          throw new UnprocessableEntityException({
            message:
              'Payment amount would exceed the outstanding amount for this demand category',
            errorCode: 'PAYMENT_EXCEEDS_DUE_AMOUNT',
          });
        }

        // is_partial is derived, never client-supplied. Reuses alreadyPaid
        // and item.amount already computed above for the outstanding
        // check — no extra query.
        const newTotalPaid = alreadyPaid.plus(dto.amount_paid);
        const isPartial = newTotalPaid.lessThan(item.amount);

        return tx.fee_payments.create({
          data: {
            student_fee_demand_mapping_id: demandMappingId,
            fee_structure_item_id: item.id,
            amount_paid: dto.amount_paid,
            receipt_no: receiptNo,
            payment_mode: dto.payment_mode,
            is_partial: isPartial,
            collected_by_user_id: collectedByUserId,
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  /**
   * Generates the next sequential receipt number: RCP001, RCP002, RCP003, ...
   *
   * No UUID, no timestamp — the numeric suffix is derived from the highest
   * existing RCP-formatted receipt_no in fee_payments, read inside the same
   * SERIALIZABLE transaction as the rest of create(). That isolation level
   * (plus the pre-existing UNIQUE constraint on receipt_no as a hard
   * safety net, backed by the retry-on-conflict logic in create()) is what
   * makes this safe under concurrent requests — two simultaneous payments
   * cannot both compute and persist the same "next" number.
   *
   * Legacy receipt_no values that don't match the RCP### pattern (e.g.
   * pre-existing manually-entered receipts) are ignored by the regexp and
   * never influence the next generated number.
   */
  private async generateNextReceiptNo(
    tx: Prisma.TransactionClient,
  ): Promise<string> {
    const result = await tx.$queryRaw<{ max_num: number | null }[]>`
      SELECT MAX((regexp_match(receipt_no, '^RCP(\\d+)$'))[1]::int) AS max_num
      FROM fee_payments
    `;

    const nextNumber = (result[0]?.max_num ?? 0) + 1;
    return `RCP${String(nextNumber).padStart(3, '0')}`;
  }

  // ── Student-facing Razorpay gateway (POST /me/fees/*) ────────────────────
  //
  // Deliberately separate from create()/createWithinTransaction() above,
  // which is the admin/staff category-wise (fee_structure_item_id-scoped)
  // recording flow. The mobile "Pay fees" screen has no per-category UI -
  // it only ever shows one lump total/paid/due per demand mapping - so the
  // methods below pay toward a mapping's TOTAL outstanding as a whole,
  // with fee_structure_item_id left null on the resulting fee_payments row.
  // Both flows write to the same fee_payments table and both count toward
  // the same outstanding calculation, so a mapping can be partly paid by
  // staff (category-wise) and partly online (mapping-wise) with no double
  // counting.

  /**
   * POST /me/fees/demands/:id/payment-order (Student, self-scoped).
   * Stages a Razorpay order - the real fee_payments row is only created
   * later, once verifyGatewayPayment() confirms the signature. Mirrors
   * WalletService.createTopupOrder/verifyTopup exactly, just fee-scoped.
   *
   * Error cases:
   *  404 STUDENT_NOT_FOUND            – caller has no linked student record
   *  404 STUDENT_FEE_DEMAND_NOT_FOUND – no demand mapping with the given id
   *  403 NOT_YOUR_DEMAND              – the mapping belongs to a different student
   *  422 AMOUNT_EXCEEDS_OUTSTANDING   – amount would exceed this mapping's outstanding
   *  500 RAZORPAY_NOT_CONFIGURED / INTERNAL_ERROR
   */
  async createGatewayOrder(
    userId: number,
    demandMappingId: number,
    dto: CreateFeePaymentOrderDto,
  ) {
    const mapping = await this.resolveOwnDemandMapping(userId, demandMappingId);
    return this.stageGatewayOrder(
      demandMappingId,
      mapping.fee_structure_id,
      dto.amount,
      userId,
    );
  }

  /**
   * POST /me/children/:studentId/fees/demands/:id/payment-order (Parent,
   * scoped to a verified child - the parent-child link itself is checked
   * upstream by ParentsService.assertOwnChild, same as every other
   * parent-on-behalf-of-child read; this only re-checks that the demand
   * mapping id actually belongs to studentId, as defense in depth against
   * a mismatched/forged id).
   *
   * created_by_user_id on both the gateway order and (once verified) the
   * resulting fee_payments row is the PARENT's own user id, not the
   * student's - who actually paid is worth keeping distinct from whose
   * fee it was. The fee_payment_confirmed notification still always goes
   * to the student (see notifyPaymentConfirmed), regardless of who paid.
   *
   * Error cases: same as createGatewayOrder, plus:
   *  403 NOT_YOUR_CHILDS_DEMAND – the mapping belongs to a different student
   */
  async createGatewayOrderForChild(
    parentUserId: number,
    studentId: number,
    demandMappingId: number,
    dto: CreateFeePaymentOrderDto,
  ) {
    const mapping = await this.resolveChildDemandMapping(
      studentId,
      demandMappingId,
    );
    return this.stageGatewayOrder(
      demandMappingId,
      mapping.fee_structure_id,
      dto.amount,
      parentUserId,
    );
  }

  private async stageGatewayOrder(
    demandMappingId: number,
    feeStructureId: number,
    amount: number,
    createdByUserId: number,
  ) {
    const outstanding = await this.computeMappingOutstanding(
      demandMappingId,
      feeStructureId,
    );

    if (new Prisma.Decimal(amount).greaterThan(outstanding)) {
      throw new UnprocessableEntityException({
        message:
          'Payment amount would exceed the outstanding amount for this fee demand',
        errorCode: 'AMOUNT_EXCEEDS_OUTSTANDING',
      });
    }

    const razorpay = this.getRazorpay();
    const order = await razorpay.orders.create({
      amount: Math.round(amount * 100), // rupees -> paise
      currency: 'INR',
      receipt: `fee-${demandMappingId}-${Date.now()}`,
    });

    try {
      await this.prisma.fee_payment_gateway_orders.create({
        data: {
          student_fee_demand_mapping_id: demandMappingId,
          amount,
          status: 'pending',
          razorpay_order_id: order.id,
          created_by_user_id: createdByUserId,
        },
      });
    } catch (err) {
      this.logger.error(
        'DB error while staging fee payment gateway order',
        err,
      );
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }

    return {
      order_id: order.id,
      amount,
      currency: 'INR',
      key_id: process.env.RAZORPAY_KEY_ID,
    };
  }

  /**
   * POST /me/fees/payment-order/verify (Student) or
   * POST /me/children/:studentId/fees/payment-order/verify (Parent) -
   * shared by both callers unchanged. Ownership here is keyed by "did YOU
   * create this order" (order.created_by_user_id === userId), not by role
   * or student_id, so a parent verifying an order they staged via
   * createGatewayOrderForChild works exactly the same way as a student
   * verifying their own - no separate method needed.
   *
   * Recomputes the HMAC-SHA256 signature server-side, exactly like
   * WalletService.verifyTopup - never trusts the client's claim that
   * Checkout succeeded. Only records the fee payment on a genuine match.
   *
   * Error cases:
   *  404 GATEWAY_ORDER_NOT_FOUND     – no order matches for this caller
   *  400 ALREADY_PROCESSED           – this order has already been verified
   *  400 PAYMENT_VERIFICATION_FAILED – signature mismatch
   *  422 AMOUNT_EXCEEDS_OUTSTANDING  – the mapping's outstanding shrank below
   *                                    the ordered amount since the order was
   *                                    staged (e.g. a staff payment posted in
   *                                    the gap) - Razorpay has already
   *                                    charged the student at this point, so
   *                                    this is left 'failed' for manual
   *                                    finance reconciliation, not silently
   *                                    swallowed.
   */
  async verifyGatewayPayment(userId: number, dto: VerifyFeePaymentDto) {
    const order = await this.prisma.fee_payment_gateway_orders.findUnique({
      where: { razorpay_order_id: dto.razorpay_order_id },
    });
    if (!order || order.created_by_user_id !== userId) {
      throw new NotFoundException({
        message: 'No matching payment order found for your account',
        errorCode: 'GATEWAY_ORDER_NOT_FOUND',
      });
    }
    if (order.status !== 'pending') {
      throw new BadRequestException({
        message: 'This payment order has already been processed',
        errorCode: 'ALREADY_PROCESSED',
      });
    }

    const secret = process.env.RAZORPAY_KEY_SECRET;
    if (!secret) {
      throw new InternalServerErrorException({
        message: 'Razorpay is not configured',
        errorCode: 'RAZORPAY_NOT_CONFIGURED',
      });
    }
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(`${dto.razorpay_order_id}|${dto.razorpay_payment_id}`)
      .digest('hex');

    if (expectedSignature !== dto.razorpay_signature) {
      await this.prisma.fee_payment_gateway_orders.update({
        where: { id: order.id },
        data: {
          status: 'failed',
          razorpay_payment_id: dto.razorpay_payment_id,
          razorpay_signature: dto.razorpay_signature,
        },
      });
      throw new BadRequestException({
        message: "Payment verification failed - signature doesn't match",
        errorCode: 'PAYMENT_VERIFICATION_FAILED',
      });
    }

    let payment: {
      id: number;
      amount_paid: Prisma.Decimal;
      receipt_no: string;
    };
    try {
      payment = await this.createMappingLevelPayment(
        order.student_fee_demand_mapping_id,
        Number(order.amount),
        userId,
      );
    } catch (err) {
      // The money has already been charged by Razorpay at this point - mark
      // the order failed (not left stuck 'pending' forever) so finance has
      // something concrete to reconcile, then let the real error surface.
      await this.prisma.fee_payment_gateway_orders.update({
        where: { id: order.id },
        data: {
          status: 'failed',
          razorpay_payment_id: dto.razorpay_payment_id,
          razorpay_signature: dto.razorpay_signature,
        },
      });
      throw err;
    }

    await this.prisma.fee_payment_gateway_orders.update({
      where: { id: order.id },
      data: {
        status: 'success',
        razorpay_payment_id: dto.razorpay_payment_id,
        razorpay_signature: dto.razorpay_signature,
        fee_payment_id: payment.id,
      },
    });

    this.logger.log(
      `Fee payment gateway order verified: order=${order.id} payment=${payment.id}`,
    );

    return {
      fee_payment_id: payment.id,
      amount_paid: Number(payment.amount_paid),
      receipt_no: payment.receipt_no,
    };
  }

  private async resolveOwnDemandMapping(
    userId: number,
    demandMappingId: number,
  ) {
    const student = await this.prisma.students.findUnique({
      where: { user_id: userId },
      select: { id: true },
    });
    if (!student) {
      throw new NotFoundException({
        message: 'Student profile not found for this account',
        errorCode: 'STUDENT_NOT_FOUND',
      });
    }

    const mapping = await this.prisma.student_fee_demand_mapping.findUnique({
      where: { id: demandMappingId },
      select: { student_id: true, fee_structure_id: true },
    });
    if (!mapping) {
      throw new NotFoundException({
        message: 'Student fee demand mapping not found',
        errorCode: 'STUDENT_FEE_DEMAND_NOT_FOUND',
      });
    }
    if (mapping.student_id !== student.id) {
      throw new ForbiddenException({
        message: 'You may only pay your own fees',
        errorCode: 'NOT_YOUR_DEMAND',
      });
    }

    return mapping;
  }

  /**
   * Parent-on-behalf-of-child counterpart to resolveOwnDemandMapping - no
   * students.findUnique(where:{user_id}) lookup needed since studentId is
   * already given (and already verified to belong to this parent by
   * ParentsService.assertOwnChild before this is ever called); this only
   * re-checks that demandMappingId itself actually belongs to that student.
   */
  private async resolveChildDemandMapping(
    studentId: number,
    demandMappingId: number,
  ) {
    const mapping = await this.prisma.student_fee_demand_mapping.findUnique({
      where: { id: demandMappingId },
      select: { student_id: true, fee_structure_id: true },
    });
    if (!mapping) {
      throw new NotFoundException({
        message: 'Student fee demand mapping not found',
        errorCode: 'STUDENT_FEE_DEMAND_NOT_FOUND',
      });
    }
    if (mapping.student_id !== studentId) {
      throw new ForbiddenException({
        message: 'This fee demand does not belong to this student',
        errorCode: 'NOT_YOUR_CHILDS_DEMAND',
      });
    }

    return mapping;
  }

  private async computeMappingOutstanding(
    demandMappingId: number,
    feeStructureId: number,
  ): Promise<Prisma.Decimal> {
    const [items, paidResult] = await this.prisma.$transaction([
      this.prisma.fee_structure_items.findMany({
        where: { fee_structure_id: feeStructureId },
        select: { amount: true },
      }),
      this.prisma.fee_payments.aggregate({
        where: { student_fee_demand_mapping_id: demandMappingId },
        _sum: { amount_paid: true },
      }),
    ]);

    const liveTotalAmount = this.computeLiveTotalAmount(items);
    const paidAmount = paidResult._sum.amount_paid ?? new Prisma.Decimal(0);
    return computeOutstanding(liveTotalAmount, paidAmount);
  }

  /**
   * MAX_SERIALIZATION_RETRIES + SERIALIZABLE isolation, mirroring
   * create()/createWithinTransaction() above - a concurrent staff payment
   * against the same mapping is the exact same class of race.
   */
  private async createMappingLevelPayment(
    demandMappingId: number,
    amount: number,
    collectedByUserId: number,
  ) {
    const MAX_SERIALIZATION_RETRIES = 3;

    for (let attempt = 1; attempt <= MAX_SERIALIZATION_RETRIES; attempt++) {
      try {
        const payment = await this.prisma.$transaction(
          async (tx) => {
            const mapping = await tx.student_fee_demand_mapping.findUnique({
              where: { id: demandMappingId },
              select: { fee_structure_id: true },
            });
            if (!mapping) {
              throw new NotFoundException({
                message: 'Student fee demand mapping not found',
                errorCode: 'STUDENT_FEE_DEMAND_NOT_FOUND',
              });
            }

            const items = await tx.fee_structure_items.findMany({
              where: { fee_structure_id: mapping.fee_structure_id },
              select: { amount: true },
            });
            const liveTotalAmount = this.computeLiveTotalAmount(items);

            const paidSoFarResult = await tx.fee_payments.aggregate({
              where: { student_fee_demand_mapping_id: demandMappingId },
              _sum: { amount_paid: true },
            });
            const alreadyPaid =
              paidSoFarResult._sum.amount_paid ?? new Prisma.Decimal(0);
            const outstanding = computeOutstanding(
              liveTotalAmount,
              alreadyPaid,
            );

            if (new Prisma.Decimal(amount).greaterThan(outstanding)) {
              throw new UnprocessableEntityException({
                message:
                  'Payment amount would exceed the outstanding amount for this fee demand',
                errorCode: 'AMOUNT_EXCEEDS_OUTSTANDING',
              });
            }

            const receiptNo = await this.generateNextReceiptNo(tx);
            const newTotalPaid = alreadyPaid.plus(amount);
            const isPartial = newTotalPaid.lessThan(liveTotalAmount);

            return tx.fee_payments.create({
              data: {
                student_fee_demand_mapping_id: demandMappingId,
                fee_structure_item_id: null,
                amount_paid: amount,
                receipt_no: receiptNo,
                payment_mode: 'razorpay',
                is_partial: isPartial,
                collected_by_user_id: collectedByUserId,
              },
            });
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );

        await this.notifyPaymentConfirmed(demandMappingId, payment);
        return payment;
      } catch (err) {
        const isSerializationConflict =
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2034';
        const isReceiptNumberRace =
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2002' &&
          (err.meta?.target as string[] | undefined)?.includes('receipt_no');
        const isRetryableConflict =
          isSerializationConflict || isReceiptNumberRace;

        if (isRetryableConflict && attempt < MAX_SERIALIZATION_RETRIES) {
          continue;
        }
        if (isRetryableConflict) {
          throw new ConflictException({
            message:
              'This payment could not be completed due to a concurrent update. Please try again.',
            errorCode: 'CONCURRENT_PAYMENT_CONFLICT',
          });
        }
        if (
          err instanceof NotFoundException ||
          err instanceof ConflictException ||
          err instanceof UnprocessableEntityException
        ) {
          throw err;
        }
        this.logger.error('DB error while recording gateway fee payment', err);
        throw new InternalServerErrorException({
          message: 'Something went wrong. Please try again.',
          errorCode: 'INTERNAL_ERROR',
        });
      }
    }
    // Unreachable - the loop always either returns or throws.
    throw new InternalServerErrorException({
      message: 'Something went wrong. Please try again.',
      errorCode: 'INTERNAL_ERROR',
    });
  }

  /**
   * PUT/PATCH /fee-payments/:id
   *
   * student_fee_demand_mapping_id is immutable — the payment remains attached
   * to its original demand mapping.
   *
   * Error cases:
   *  404 FEE_PAYMENT_NOT_FOUND        – no payment with the given id
   *  404 USER_NOT_FOUND                – collected_by_user_id does not exist
   *  409 FEE_PAYMENT_RECEIPT_EXISTS    – receipt_no already used by another payment
   *  422 PAYMENT_EXCEEDS_DUE_AMOUNT    – amount_paid would exceed the demand's total_amount
   */
  async update(id: number, dto: UpdateFeePaymentDto) {
    const payment = await this.findById(id);

    if (!payment) {
      throw new NotFoundException({
        message: 'Fee payment not found',
        errorCode: 'FEE_PAYMENT_NOT_FOUND',
      });
    }

    if (
      dto.collected_by_user_id !== undefined &&
      dto.collected_by_user_id !== null
    ) {
      await this.assertUserExists(dto.collected_by_user_id);
    }

    if (dto.receipt_no !== undefined && dto.receipt_no !== payment.receipt_no) {
      await this.assertReceiptNoAvailable(dto.receipt_no, id);
    }

    if (dto.amount_paid !== undefined) {
      const mapping = await this.assertDemandMappingExists(
        payment.student_fee_demand_mapping_id,
      );
      await this.assertWithinDueAmount(
        payment.student_fee_demand_mapping_id,
        mapping.total_amount,
        dto.amount_paid,
        id,
      );
    }

    try {
      return await this.prisma.fee_payments.update({
        where: { id },
        data: {
          amount_paid: dto.amount_paid,
          receipt_no: dto.receipt_no,
          payment_mode: dto.payment_mode,
          is_partial: dto.is_partial,
          collected_by_user_id: dto.collected_by_user_id,
        },
      });
    } catch (err) {
      this.logger.error('DB error while updating fee payment', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * DELETE /fee-payments/:id
   *
   * Error cases:
   *  404 FEE_PAYMENT_NOT_FOUND – no payment with the given id
   */
  async remove(id: number) {
    const payment = await this.findById(id);

    if (!payment) {
      throw new NotFoundException({
        message: 'Fee payment not found',
        errorCode: 'FEE_PAYMENT_NOT_FOUND',
      });
    }

    try {
      return await this.prisma.fee_payments.delete({
        where: { id },
      });
    } catch (err) {
      this.logger.error('DB error while deleting fee payment', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  private async assertDemandMappingExists(demandMappingId: number) {
    let mapping: { total_amount: Prisma.Decimal } | null;

    try {
      mapping = await this.prisma.student_fee_demand_mapping.findUnique({
        where: { id: demandMappingId },
        select: { total_amount: true },
      });
    } catch (err) {
      this.logger.error(
        'DB error during student fee demand mapping lookup',
        err,
      );
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }

    if (!mapping) {
      throw new NotFoundException({
        message: 'Student fee demand mapping not found',
        errorCode: 'STUDENT_FEE_DEMAND_NOT_FOUND',
      });
    }

    return mapping;
  }

  private async assertUserExists(userId: number) {
    let user: unknown;

    try {
      user = await this.prisma.users.findUnique({ where: { id: userId } });
    } catch (err) {
      this.logger.error('DB error during user lookup', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }

    if (!user) {
      throw new NotFoundException({
        message: 'User not found',
        errorCode: 'USER_NOT_FOUND',
      });
    }
  }

  private async assertReceiptNoAvailable(
    receiptNo: string,
    excludeId?: number,
  ) {
    let existing: { id: number } | null;

    try {
      existing = await this.prisma.fee_payments.findUnique({
        where: { receipt_no: receiptNo },
        select: { id: true },
      });
    } catch (err) {
      this.logger.error(
        'DB error during fee payment receipt duplicate check',
        err,
      );
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }

    if (existing && existing.id !== excludeId) {
      throw new ConflictException({
        message: 'A fee payment with this receipt number already exists',
        errorCode: 'FEE_PAYMENT_RECEIPT_EXISTS',
      });
    }
  }

  /**
   * Application-level financial integrity rule (not encoded in schema.prisma):
   * the sum of all payments recorded against a student's fee demand must never
   * exceed that demand's total_amount.
   */
  private async assertWithinDueAmount(
    demandMappingId: number,
    totalAmount: Prisma.Decimal,
    incomingAmount: number,
    excludeId?: number,
  ) {
    let collectedSoFar: Prisma.Decimal;

    try {
      const result = await this.prisma.fee_payments.aggregate({
        where: {
          student_fee_demand_mapping_id: demandMappingId,
          ...(excludeId !== undefined ? { id: { not: excludeId } } : {}),
        },
        _sum: { amount_paid: true },
      });

      collectedSoFar = result._sum.amount_paid ?? new Prisma.Decimal(0);
    } catch (err) {
      this.logger.error('DB error while summing fee payments', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }

    const projectedTotal = collectedSoFar.plus(incomingAmount);

    if (projectedTotal.greaterThan(totalAmount)) {
      throw new UnprocessableEntityException({
        message:
          'Payment amount would exceed the total amount due for this fee demand',
        errorCode: 'PAYMENT_EXCEEDS_DUE_AMOUNT',
      });
    }
  }

  private async findById(id: number) {
    try {
      return await this.prisma.fee_payments.findUnique({ where: { id } });
    } catch (err) {
      this.logger.error('DB error during fee payment lookup', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * POST /fee-payments/receipt-numbers
   *
   * Issues exactly one new, sequential receipt number (fee_receipt_numbers.id
   * — a real DB-generated SERIAL, never computed client-side) covering every
   * fee_payment_id in the request, together in one print action. This is
   * deliberately separate from fee_payments.receipt_no, which is really each
   * payment's own internal reference and was never meant to be the number
   * printed on a receipt.
   *
   * Error cases:
   *  404 FEE_PAYMENT_NOT_FOUND – one or more fee_payment_ids don't exist
   *  500 INTERNAL_ERROR        – unexpected failure (DB, etc.)
   */
  async issueReceiptNumber(
    dto: IssueReceiptNumberDto,
    issuedByUserId: number | null,
  ) {
    const uniqueIds = [...new Set(dto.fee_payment_ids)];

    let found: { id: number }[];
    try {
      found = await this.prisma.fee_payments.findMany({
        where: { id: { in: uniqueIds } },
        select: { id: true },
      });
    } catch (err) {
      this.logger.error('DB error while validating fee payments for receipt number', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }

    if (found.length !== uniqueIds.length) {
      throw new NotFoundException({
        message: 'One or more fee payments were not found',
        errorCode: 'FEE_PAYMENT_NOT_FOUND',
      });
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const receiptNumber = await tx.fee_receipt_numbers.create({
          data: {
            print_date: new Date(dto.print_date),
            issued_by_user_id: issuedByUserId ?? undefined,
          },
        });

        await tx.fee_receipt_number_payments.createMany({
          data: uniqueIds.map((feePaymentId) => ({
            receipt_number_id: receiptNumber.id,
            fee_payment_id: feePaymentId,
          })),
        });

        return receiptNumber;
      });
    } catch (err) {
      this.logger.error('DB error while issuing receipt number', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }
}
