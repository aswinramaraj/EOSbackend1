import {
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import type { FeeReceiptData } from './receipt-pdf.util';

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function toDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

@Injectable()
export class MeFeesService {
  private readonly logger = new Logger(MeFeesService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * GET /me/fees
   *
   * Self-scoped: student_id resolved from the JWT. Reads the caller's own
   * `student_fee_demand_mapping` rows (one per fee structure they've been
   * demanded, e.g. per semester) joined to `fee_structures` for a display
   * name, plus every `fee_payments` row against those mappings.
   *
   * `paid`/`due`/`status` are computed here, not stored - only
   * `total_amount` exists on student_fee_demand_mapping.
   *
   * Error cases:
   *  404 STUDENT_NOT_FOUND – the authenticated user has no linked student record
   *  500 INTERNAL_ERROR    – unexpected DB failure
   */
  async getMyFees(userId: number) {
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

    return this.computeFees(student.id);
  }

  /**
   * Same computation as getMyFees, but for a student chosen by id rather
   * than resolved from the caller's own JWT - used by ParentsService once
   * it has verified (via parent_student_mapping) that the caller is
   * actually this student's parent.
   */
  async getFeesForStudentId(studentId: number) {
    return this.computeFees(studentId);
  }

  private async computeFees(studentId: number) {
    const mappings = await this.fetchDemandMappings(studentId);

    const demands = mappings.map((mapping) => {
      const total = Number(mapping.total_amount);
      const paid = mapping.fee_payments.reduce(
        (sum, payment) => sum + Number(payment.amount_paid),
        0,
      );
      const due = round2(total - paid);
      const status: 'paid' | 'partial' | 'pending' =
        due <= 0 && total > 0 ? 'paid' : paid > 0 ? 'partial' : 'pending';

      return {
        id: mapping.id,
        fee_structure_name: mapping.fee_structures.name,
        academic_year: mapping.academic_year,
        semester: mapping.semester,
        total,
        paid: round2(paid),
        due,
        status,
      };
    });

    const payments = mappings.flatMap((mapping) =>
      mapping.fee_payments.map((payment) => ({
        id: payment.id,
        demand_id: mapping.id,
        fee_structure_name: mapping.fee_structures.name,
        amount_paid: Number(payment.amount_paid),
        payment_date: toDateOnly(payment.payment_date),
        payment_mode: payment.payment_mode,
        receipt_no: payment.receipt_no,
        is_partial: payment.is_partial,
      })),
    );

    return { demands, payments };
  }

  /**
   * GET /me/fees/payments/:paymentId/receipt
   *
   * Self-scoped: only a fee_payments row belonging to one of the caller's
   * own student_fee_demand_mapping rows can be fetched. Student name prefers
   * soa_applications' first_name/last_name (the same real admission-record
   * name used elsewhere - e.g. lms.service.ts's resolveStudentName), falling
   * back to the account email when no soa_applications row exists, since a
   * receipt should always show *some* name rather than "NA".
   */
  async getReceiptData(userId: number, paymentId: number): Promise<FeeReceiptData> {
    const student = await this.prisma.students.findUnique({
      where: { user_id: userId },
      select: {
        id: true,
        register_no: true,
        soa_applications: { select: { first_name: true, last_name: true } },
        users: { select: { email: true } },
      },
    });
    if (!student) {
      throw new NotFoundException({
        message: 'Student profile not found for this account',
        errorCode: 'STUDENT_NOT_FOUND',
      });
    }

    const payment = await this.prisma.fee_payments.findUnique({
      where: { id: paymentId },
      select: {
        receipt_no: true,
        payment_date: true,
        amount_paid: true,
        payment_mode: true,
        is_partial: true,
        student_fee_demand_mapping: {
          select: {
            student_id: true,
            academic_year: true,
            semester: true,
            fee_structures: { select: { name: true } },
          },
        },
      },
    });
    if (!payment) {
      throw new NotFoundException({
        message: 'Payment not found',
        errorCode: 'PAYMENT_NOT_FOUND',
      });
    }
    if (payment.student_fee_demand_mapping.student_id !== student.id) {
      throw new ForbiddenException({
        message: 'This receipt does not belong to you',
        errorCode: 'RECEIPT_NOT_YOURS',
      });
    }

    const studentName = student.soa_applications
      ? [student.soa_applications.first_name, student.soa_applications.last_name].filter(Boolean).join(' ')
      : student.users.email;

    return {
      receipt_no: payment.receipt_no,
      payment_date: toDateOnly(payment.payment_date),
      student_name: studentName,
      register_no: student.register_no,
      fee_structure_name: payment.student_fee_demand_mapping.fee_structures.name,
      academic_year: payment.student_fee_demand_mapping.academic_year,
      semester: payment.student_fee_demand_mapping.semester,
      amount_paid: Number(payment.amount_paid),
      payment_mode: payment.payment_mode,
      is_partial: payment.is_partial,
    };
  }

  private async fetchDemandMappings(studentId: number) {
    try {
      return await this.prisma.student_fee_demand_mapping.findMany({
        where: { student_id: studentId },
        select: {
          id: true,
          academic_year: true,
          semester: true,
          total_amount: true,
          fee_structures: { select: { name: true } },
          fee_payments: {
            select: {
              id: true,
              amount_paid: true,
              payment_date: true,
              payment_mode: true,
              receipt_no: true,
              is_partial: true,
            },
            orderBy: { payment_date: 'desc' },
          },
        },
        orderBy: [{ academic_year: 'desc' }, { semester: 'desc' }],
      });
    } catch (err) {
      this.logger.error(`Failed to fetch fees for student ${studentId}`, err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }
}
