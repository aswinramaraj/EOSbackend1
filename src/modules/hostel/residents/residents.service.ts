import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import type { Prisma } from 'generated/prisma/client';
import { formatStudentName } from '../common/student-name.util';
import { SearchResidentsDto } from './dto/search-residents.dto';

const RESIDENT_INCLUDE = {
  soa_applications: { select: { first_name: true, last_name: true } },
  users: { select: { email: true } },
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
  const name = formatStudentName(
    student.soa_applications?.first_name,
    student.soa_applications?.last_name,
    student.users.email,
  );

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

    if (student_id) {
      where.id = student_id;
    }

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
   * GET /hostel/residents/:id — full profile for the shared "click a
   * student name to see their details" pattern used across every hostel
   * warden page. Recent movements/outings/complaints are real, scoped to
   * this one student; `hostelId` (when set) enforces that a warden can
   * only open a profile for a resident of their own hostel.
   */
  async findOne(id: number, hostelId: number | null) {
    let student: ResidentWithRelations | null;
    try {
      student = await this.prisma.students.findUnique({
        where: { id },
        include: RESIDENT_INCLUDE,
      });
    } catch (err) {
      this.logger.error(`DB error while fetching resident ${id}`, err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }

    if (!student || !student.student_hostel_mapping) {
      throw new NotFoundException({
        message: 'Resident not found',
        errorCode: 'RESIDENT_NOT_FOUND',
      });
    }
    if (
      hostelId != null &&
      student.student_hostel_mapping.hostel_rooms.hostel_id !== hostelId
    ) {
      throw new NotFoundException({
        message: 'Resident not found',
        errorCode: 'RESIDENT_NOT_FOUND',
      });
    }

    const onLeaveStudentIds = await this.findOnLeaveStudentIds([id]);

    try {
      const [movements, outings, complaints] = await this.prisma.$transaction([
        this.prisma.hostel_in_out_ledger.findMany({
          where: { student_id: id },
          orderBy: { recorded_at: 'desc' },
          take: 10,
          select: { id: true, entry_type: true, recorded_at: true },
        }),
        this.prisma.hostel_outings.findMany({
          where: { student_id: id },
          orderBy: { created_at: 'desc' },
          take: 10,
          select: {
            id: true,
            reason: true,
            from_date: true,
            to_date: true,
            status: true,
          },
        }),
        this.prisma.hostel_complaints.findMany({
          where: { student_id: id },
          orderBy: { created_at: 'desc' },
          take: 10,
          select: {
            id: true,
            title: true,
            category: true,
            status: true,
            created_at: true,
          },
        }),
      ]);

      return {
        ...toResidentResponse(student, onLeaveStudentIds),
        movements: movements.map((m) => ({
          id: m.id,
          direction: m.entry_type,
          at: m.recorded_at.toISOString(),
        })),
        outings: outings.map((o) => ({
          id: o.id,
          reason: o.reason,
          from_date: o.from_date.toISOString().slice(0, 10),
          to_date: o.to_date.toISOString().slice(0, 10),
          status: o.status,
        })),
        complaints: complaints.map((c) => ({
          id: c.id,
          title: c.title,
          category: c.category,
          status: c.status,
          created_at: c.created_at.toISOString(),
        })),
      };
    } catch (err) {
      this.logger.error(`DB error while fetching resident ${id} history`, err);
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
