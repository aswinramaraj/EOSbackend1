import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { ApplyPayslipDto } from './dto/apply-payslip.dto';

function toMonthString(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

/**
 * Payslip requests — the real, pre-existing `payslip_requests` table (in
 * schema.prisma). Its `staff_user_id` column (added alongside the original
 * faculty_id) is the generic non-teaching-staff column this needs — no new
 * table. Tracks the request only; no real payroll figures are generated.
 */
@Injectable()
export class MediaRoomPayslipService {
  private readonly logger = new Logger(MediaRoomPayslipService.name);

  constructor(private readonly prisma: PrismaService) {}

  async findHistory(userId: number) {
    try {
      const rows = await this.prisma.payslip_requests.findMany({
        where: { staff_user_id: userId },
        orderBy: { requested_at: 'desc' },
      });
      return {
        ready: true,
        data: rows.map((r) => ({ id: r.id, month: toMonthString(r.year, r.month), status: r.status, file_url: r.file_url, requested_at: r.requested_at, purpose: r.purpose })),
      };
    } catch (err) {
      this.logger.error('DB error listing payslip requests', err);
      throw new InternalServerErrorException({ message: 'Something went wrong. Please try again.', errorCode: 'INTERNAL_ERROR' });
    }
  }

  async apply(dto: ApplyPayslipDto, userId: number) {
    const [year, month] = dto.month.split('-').map(Number);
    try {
      const row = await this.prisma.payslip_requests.create({
        data: { staff_user_id: userId, year, month, purpose: dto.purpose },
      });
      return { id: row.id, month: toMonthString(row.year, row.month), status: row.status, file_url: row.file_url, requested_at: row.requested_at, purpose: row.purpose };
    } catch (err) {
      this.logger.error('DB error creating payslip request', err);
      throw new InternalServerErrorException({ message: 'Something went wrong. Please try again.', errorCode: 'INTERNAL_ERROR' });
    }
  }
}
