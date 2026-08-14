import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { Prisma } from 'generated/prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { HostelFeeYearCode, SearchHostelFeesDto } from './dto/search-hostel-fees.dto';

type FeeStatus = 'unpaid' | 'partially_paid' | 'paid';

export interface FeeRow {
  student_id: number;
  name: string;
  student_id_no: string;
  hostel: { id: number; name: string; code: string; wing: string } | null;
  block: { id: number; name: string } | null;
  room_number: string | null;
  sharing: string | null;
  year: HostelFeeYearCode | null;
  total_amount: number;
  paid_amount: number;
  balance: number;
  status: FeeStatus;
}

/** ceil(current_semester / 2), clamped to the course's actual length - a course never has a "5th year" just because a semester value drifted past its duration. */
function resolveYearCode(
  currentSemester: number | null | undefined,
  durationYears: number | null | undefined,
): HostelFeeYearCode | null {
  if (!currentSemester || !durationYears) return null;

  const year = Math.min(Math.ceil(currentSemester / 2), durationYears);
  const isPostgraduate = durationYears <= 2;
  return `${isPostgraduate ? 'pg' : 'ug'}${year}` as HostelFeeYearCode;
}

@Injectable()
export class HostelFeesService {
  private readonly logger = new Logger(HostelFeesService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * GET /hostel/fees?wing=&block_id=&year=&search=&status=&page=&page_size=
   *
   * Reuses the generic fees-billing pipeline (fee_structures /
   * student_fee_demand_mapping / fee_payments) rather than a separate
   * hostel-specific invoice model — student_hostel_mapping.fee_structure_id
   * already links a resident to their hostel fee structure. Status is
   * computed (paid/partially_paid/unpaid), not a stored column, and there's
   * no due-date column anywhere in the fee-demand model, so an "overdue"
   * state isn't derivable yet. year/search filtering also happens in
   * application code after the fetch - fine at college-hostel scale
   * (hundreds of residents, not hundreds of thousands).
   */
  async findAll(dto: SearchHostelFeesDto) {
    const {
      hostel_id,
      wing,
      block_id,
      year,
      search,
      status,
      page = 1,
      page_size = 20,
    } = dto;

    const mappings = await this.fetchMappingsWithFeeStructure({
      hostelId: hostel_id,
      wing,
      blockId: block_id,
    });

    const rows: FeeRow[] = mappings.map((mapping) => {
      const student = mapping.students;
      const name = student.soa_applications
        ? `${student.soa_applications.first_name} ${student.soa_applications.last_name ?? ''}`.trim()
        : `Student ${student.student_id_no}`;

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
        block: mapping.hostel_rooms.hostel_blocks,
        room_number: mapping.hostel_rooms.room_number,
        sharing: mapping.hostel_rooms.hostel_room_types.name,
        year: resolveYearCode(
          student.classes?.current_semester,
          student.classes?.courses.duration_years,
        ),
        total_amount: totalAmount,
        paid_amount: paidAmount,
        balance: totalAmount - paidAmount,
        status: feeStatus,
      };
    });

    const searchTerm = search?.trim().toLowerCase();

    const filtered = rows.filter((r) => {
      if (status && r.status !== status) return false;
      if (year && r.year !== year) return false;
      if (
        searchTerm &&
        !r.name.toLowerCase().includes(searchTerm) &&
        !r.student_id_no.toLowerCase().includes(searchTerm) &&
        !r.room_number?.toLowerCase().includes(searchTerm)
      ) {
        return false;
      }
      return true;
    });

    const total = filtered.length;
    const paged = filtered.slice((page - 1) * page_size, page * page_size);

    return { page, page_size, total, data: paged };
  }

  private async fetchMappingsWithFeeStructure(filters: {
    hostelId?: number;
    wing?: 'boys' | 'girls';
    blockId?: number;
  }) {
    const hostelRoomsWhere: Prisma.hostel_roomsWhereInput = {};
    if (filters.hostelId) hostelRoomsWhere.hostel_id = filters.hostelId;
    if (filters.blockId) hostelRoomsWhere.block_id = filters.blockId;
    if (filters.wing) hostelRoomsWhere.hostels = { wing: filters.wing };

    try {
      return await this.prisma.student_hostel_mapping.findMany({
        where: {
          fee_structure_id: { not: null },
          ...(Object.keys(hostelRoomsWhere).length
            ? { hostel_rooms: hostelRoomsWhere }
            : {}),
        },
        include: {
          students: {
            select: {
              id: true,
              student_id_no: true,
              soa_applications: {
                select: { first_name: true, last_name: true },
              },
              student_fee_demand_mapping: {
                select: {
                  fee_structure_id: true,
                  total_amount: true,
                  fee_payments: { select: { amount_paid: true } },
                },
              },
              classes: {
                select: {
                  current_semester: true,
                  courses: { select: { duration_years: true } },
                },
              },
            },
          },
          hostel_rooms: {
            include: {
              hostels: {
                select: { id: true, name: true, code: true, wing: true },
              },
              hostel_room_types: { select: { name: true } },
              hostel_blocks: { select: { id: true, name: true } },
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
