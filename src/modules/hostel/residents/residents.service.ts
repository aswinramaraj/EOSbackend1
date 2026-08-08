import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import type { Prisma } from 'generated/prisma/client';
import { SearchResidentsDto } from './dto/search-residents.dto';

const RESIDENT_INCLUDE = {
  soa_applications: { select: { first_name: true, last_name: true } },
  courses: { select: { name: true } },
  batches: { select: { name: true } },
  student_family_details: {
    select: {
      father_name: true,
      father_mobile: true,
      mother_name: true,
      mother_mobile: true,
    },
  },
  student_fee_demand_mapping: {
    select: {
      fee_structure_id: true,
      total_amount: true,
      fee_payments: { select: { amount_paid: true } },
    },
  },
  student_hostel_mapping: {
    include: {
      hostel_rooms: {
        include: {
          hostels: { select: { id: true, name: true, code: true } },
          hostel_room_types: { select: { name: true } },
        },
      },
    },
  },
} satisfies Prisma.studentsInclude;

type ResidentWithRelations = Prisma.studentsGetPayload<{
  include: typeof RESIDENT_INCLUDE;
}>;

type FeeStatus = 'not_applicable' | 'unpaid' | 'partially_paid' | 'paid';

function toResidentResponse(
  student: ResidentWithRelations,
  onLeaveStudentIds: Set<number>,
) {
  const name = student.soa_applications
    ? `${student.soa_applications.first_name} ${student.soa_applications.last_name ?? ''}`.trim()
    : `Student ${student.student_id_no}`;

  const mapping = student.student_hostel_mapping;
  const room = mapping?.hostel_rooms;
  const hostel = room?.hostels;
  const family = student.student_family_details;

  let feeStatus: FeeStatus = 'not_applicable';
  if (mapping?.fee_structure_id) {
    const relevantDemands = student.student_fee_demand_mapping.filter(
      (d) => d.fee_structure_id === mapping.fee_structure_id,
    );
    const total = relevantDemands.reduce(
      (sum, d) => sum + Number(d.total_amount),
      0,
    );
    const paid = relevantDemands.reduce(
      (sum, d) =>
        sum + d.fee_payments.reduce((s, p) => s + Number(p.amount_paid), 0),
      0,
    );
    if (total > 0) {
      feeStatus =
        paid >= total ? 'paid' : paid > 0 ? 'partially_paid' : 'unpaid';
    }
  }

  return {
    id: student.id,
    student_id_no: student.student_id_no,
    roll_no: student.roll_no,
    name,
    course: student.courses.name,
    batch: student.batches.name,
    hostel: hostel
      ? { id: hostel.id, name: hostel.name, code: hostel.code }
      : null,
    room: room ? { id: room.id, room_number: room.room_number } : null,
    sharing: room?.hostel_room_types?.name ?? null,
    guardian_name: family?.father_name ?? family?.mother_name ?? null,
    guardian_phone: family?.father_mobile ?? family?.mother_mobile ?? null,
    fee_status: feeStatus,
    allocated_date: mapping?.allocated_date ?? null,
    current_status: onLeaveStudentIds.has(student.id)
      ? 'on_leave'
      : 'in_hostel',
  };
}

@Injectable()
export class ResidentsService {
  private readonly logger = new Logger(ResidentsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * GET /hostel/residents — "Student details": every student with an active
   * hostel room assignment, i.e. hostel residency isn't a separate concept,
   * it's derived from student_hostel_mapping existing (same pattern as the
   * library module's "members" list).
   */
  async findAll(dto: SearchResidentsDto) {
    const { q, hostel_id, student_id, page = 1, page_size = 20 } = dto;

    const where: Prisma.studentsWhereInput = {
      ...(student_id !== undefined && { id: student_id }),
      student_hostel_mapping: hostel_id
        ? { hostel_rooms: { hostel_id } }
        : { isNot: null },
    };

    if (q) {
      where.OR = [
        { student_id_no: { contains: q, mode: 'insensitive' } },
        { roll_no: { contains: q, mode: 'insensitive' } },
        { register_no: { contains: q, mode: 'insensitive' } },
      ];
    }

    try {
      const [students, total] = await this.prisma.$transaction([
        this.prisma.students.findMany({
          where,
          include: RESIDENT_INCLUDE,
          orderBy: { student_id_no: 'asc' },
          skip: (page - 1) * page_size,
          take: page_size,
        }),
        this.prisma.students.count({ where }),
      ]);

      const onLeaveStudentIds = await this.findOnLeaveStudentIds(
        students.map((s) => s.id),
      );

      return {
        page,
        page_size,
        total,
        data: students.map((s) => toResidentResponse(s, onLeaveStudentIds)),
      };
    } catch (err) {
      this.logger.error('DB error while fetching hostel residents', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * "On leave" = an approved outing whose date range covers today. This is a
   * simplification — it doesn't cross-check the gate ledger for whether the
   * student has actually walked out yet, just whether they're authorized to
   * be away right now.
   */
  private async findOnLeaveStudentIds(
    studentIds: number[],
  ): Promise<Set<number>> {
    if (studentIds.length === 0) return new Set();

    const today = new Date();
    const outings = await this.prisma.hostel_outings.findMany({
      where: {
        student_id: { in: studentIds },
        status: 'approved',
        from_date: { lte: today },
        to_date: { gte: today },
      },
      select: { student_id: true },
    });

    return new Set(outings.map((o) => o.student_id));
  }
}
