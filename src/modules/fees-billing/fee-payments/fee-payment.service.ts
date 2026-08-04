import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { Prisma } from '../../../../generated/prisma/client';
import { CreateFeePaymentDto } from './dto/create-fee-payment.dto';
import { UpdateFeePaymentDto } from './dto/update-fee-payment.dto';
import { FeePaymentDashboardRowDto } from './dto/fee-payment-dashboard-row.dto';
import {
  FeePaymentStudentWorkspaceDto,
  DemandSummaryItemDto,
} from './dto/fee-payment-student-workspace.dto';

type DueStatus = 'paid' | 'partial' | 'pending';

function computeDueStatus(
  totalDemand: Prisma.Decimal,
  paidAmount: Prisma.Decimal,
): DueStatus {
  if (paidAmount.greaterThanOrEqualTo(totalDemand) && totalDemand.greaterThan(0)) {
    return 'paid';
  }
  if (paidAmount.greaterThan(0)) {
    return 'partial';
  }
  return 'pending';
}

@Injectable()
export class FeePaymentService {
  private readonly logger = new Logger(FeePaymentService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * GET /fee-payments
   */
  async findAll() {
    try {
      return await this.prisma.fee_payments.findMany({
        orderBy: [{ student_fee_demand_mapping_id: 'asc' }, { id: 'asc' }],
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
   * Error cases:
   *  404 STUDENT_FEE_DEMAND_NOT_FOUND – no demand mapping with the given id
   */
  async findAllForDemandMapping(demandMappingId: number) {
    await this.assertDemandMappingExists(demandMappingId);

    try {
      return await this.prisma.fee_payments.findMany({
        where: { student_fee_demand_mapping_id: demandMappingId },
        orderBy: { id: 'asc' },
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
      this.logger.error(
        'DB error while fetching fee payments dashboard',
        err,
      );
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }

    return mappings.map((mapping) => {
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
        fee_structure_name: mapping.fee_structures.name,
        academic_year: mapping.academic_year,
        total_demand: mapping.total_amount.toString(),
        paid_amount: paidAmount.toString(),
        outstanding_amount: mapping.total_amount.minus(paidAmount).toString(),
        due_status: computeDueStatus(mapping.total_amount, paidAmount),
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
    let student: Awaited<ReturnType<typeof this.findStudentWithWorkspaceRelations>>;

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
        const paidAmount = mapping.fee_payments.reduce(
          (sum, payment) => sum.plus(payment.amount_paid),
          new Prisma.Decimal(0),
        );

        return {
          student_fee_demand_mapping_id: mapping.id,
          fee_structure_id: mapping.fee_structure_id,
          fee_structure_name: mapping.fee_structures.name,
          academic_year: mapping.academic_year,
          semester: mapping.semester,
          total_amount: mapping.total_amount.toString(),
          paid_amount: paidAmount.toString(),
          outstanding_amount: mapping.total_amount.minus(paidAmount).toString(),
          due_status: computeDueStatus(mapping.total_amount, paidAmount),
        };
      },
    );

    const totalDemand = demandMappings.reduce(
      (sum, mapping) => sum.plus(mapping.total_amount),
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
        admission_no: student.admission_no,
        student_id_no: student.student_id_no,
        programme: student.courses.name,
        department: student.courses.departments.name,
        batch: student.batches.name,
        gender: student.gender,
        status: student.status,
      },
      fee_summary: {
        total_demand: totalDemand.toString(),
        total_paid: totalPaid.toString(),
        total_outstanding: totalDemand.minus(totalPaid).toString(),
        due_status: computeDueStatus(totalDemand, totalPaid),
      },
      demand_summary: demandSummary,
      payment_summary: {
        total_payments_count: paymentHistory.length,
        total_amount_paid: totalPaid.toString(),
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
        fee_structures: true,
        students: {
          include: {
            soa_applications: true,
            batches: true,
            courses: { include: { departments: true } },
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
        courses: { include: { departments: true } },
        student_fee_demand_mapping: {
          include: {
            fee_payments: { orderBy: { payment_date: 'desc' } },
            education_loan_dd: true,
            fee_structures: { include: { fee_concessions: true } },
          },
        },
      },
    });
  }

  /**
   * POST /student-fee-demand-mappings/:id/payments
   *
   * Error cases:
   *  404 STUDENT_FEE_DEMAND_NOT_FOUND  – no demand mapping with the given id
   *  404 USER_NOT_FOUND                – collected_by_user_id does not exist
   *  409 FEE_PAYMENT_RECEIPT_EXISTS    – receipt_no already used by another payment
   *  422 PAYMENT_EXCEEDS_DUE_AMOUNT    – amount_paid would exceed the demand's total_amount
   */
  async create(demandMappingId: number, dto: CreateFeePaymentDto) {
    const mapping = await this.assertDemandMappingExists(demandMappingId);

    if (dto.collected_by_user_id !== undefined) {
      await this.assertUserExists(dto.collected_by_user_id);
    }

    await this.assertReceiptNoAvailable(dto.receipt_no);
    await this.assertWithinDueAmount(
      demandMappingId,
      mapping.total_amount,
      dto.amount_paid,
    );

    try {
      return await this.prisma.fee_payments.create({
        data: {
          student_fee_demand_mapping_id: demandMappingId,
          amount_paid: dto.amount_paid,
          receipt_no: dto.receipt_no,
          payment_mode: dto.payment_mode,
          is_partial: dto.is_partial,
          collected_by_user_id: dto.collected_by_user_id,
        },
      });
    } catch (err) {
      this.logger.error('DB error while creating fee payment', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
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

    if (dto.collected_by_user_id !== undefined) {
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
}
