import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';

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

    const mappings = await this.fetchDemandMappings(userId, student.id);

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

  private async fetchDemandMappings(userId: number, studentId: number) {
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
      this.logger.error(`Failed to fetch fees for user ${userId}`, err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }
}
