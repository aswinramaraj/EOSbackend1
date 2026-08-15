import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { formatStudentName } from '../common/student-name.util';
import { SearchHostelFeesDto } from './dto/search-hostel-fees.dto';

type FeeStatus = 'unpaid' | 'partially_paid' | 'paid';

export interface FeeRow {
  student_id: number;
  name: string;
  student_id_no: string;
  hostel: { id: number; name: string; code: string } | null;
  room_number: string | null;
  sharing: string | null;
  total_amount: number;
  paid_amount: number;
  balance: number;
  status: FeeStatus;
}

@Injectable()
export class HostelFeesService {
  private readonly logger = new Logger(HostelFeesService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * GET /hostel/fees?hostel_id=&status=&page=&page_size=
   *
   * Reuses the generic fees-billing pipeline (fee_structures /
   * student_fee_demand_mapping / fee_payments) rather than a separate
   * hostel-specific invoice model — student_hostel_mapping.fee_structure_id
   * already links a resident to their hostel fee structure. Status is
   * computed (paid/partially_paid/unpaid), not a stored column, so
   * filtering and pagination happen in application code after the fetch —
   * fine at college-hostel scale (hundreds of residents, not hundreds of
   * thousands).
   */
  async findAll(dto: SearchHostelFeesDto) {
    const { hostel_id, status, page = 1, page_size = 20 } = dto;

    const mappings = await this.fetchMappingsWithFeeStructure(hostel_id);

    const rows: FeeRow[] = mappings.map((mapping) => {
      const student = mapping.students;
      const name = formatStudentName(
        student.soa_applications?.first_name,
        student.soa_applications?.last_name,
        student.users.email,
      );

      const relevantDemands = student.student_fee_demand_mapping.filter(
        (d) => d.fee_structure_id === mapping.fee_structure_id,
      );
      const totalAmount = relevantDemands.reduce(
        (sum, d) => sum + Number(d.total_amount),
        0,
      );
      const paidAmount = relevantDemands.reduce(
        (sum, d) =>
          sum + d.fee_payments.reduce((s, p) => s + Number(p.amount_paid), 0),
        0,
      );
      const feeStatus: FeeStatus =
        paidAmount >= totalAmount && totalAmount > 0
          ? 'paid'
          : paidAmount > 0
            ? 'partially_paid'
            : 'unpaid';

      return {
        student_id: student.id,
        name,
        student_id_no: student.student_id_no,
        hostel: mapping.hostel_rooms.hostels,
        room_number: mapping.hostel_rooms.room_number,
        sharing: mapping.hostel_rooms.hostel_room_types.name,
        total_amount: totalAmount,
        paid_amount: paidAmount,
        balance: totalAmount - paidAmount,
        status: feeStatus,
      };
    });

    const filtered = status ? rows.filter((r) => r.status === status) : rows;
    const total = filtered.length;
    const paged = filtered.slice((page - 1) * page_size, page * page_size);

    return { page, page_size, total, data: paged };
  }

  private async fetchMappingsWithFeeStructure(hostelId?: number) {
    try {
      return await this.prisma.student_hostel_mapping.findMany({
        where: {
          fee_structure_id: { not: null },
          ...(hostelId ? { hostel_rooms: { hostel_id: hostelId } } : {}),
        },
        include: {
          students: {
            select: {
              id: true,
              student_id_no: true,
              soa_applications: {
                select: { first_name: true, last_name: true },
              },
              users: { select: { email: true } },
              student_fee_demand_mapping: {
                select: {
                  fee_structure_id: true,
                  total_amount: true,
                  fee_payments: { select: { amount_paid: true } },
                },
              },
            },
          },
          hostel_rooms: {
            include: {
              hostels: { select: { id: true, name: true, code: true } },
              hostel_room_types: { select: { name: true } },
            },
          },
        },
      });
    } catch (err) {
      this.logger.error('DB error while fetching hostel fees', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }
}
