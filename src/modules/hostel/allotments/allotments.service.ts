import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import type { Prisma } from 'generated/prisma/client';
import { AssignAllotmentDto } from './dto/assign-allotment.dto';
import { ShiftAllotmentDto } from './dto/shift-allotment.dto';
import { SearchAllotmentsDto } from './dto/search-allotments.dto';

const MAPPING_INCLUDE = {
  students: {
    select: {
      id: true,
      student_id_no: true,
      soa_applications: { select: { first_name: true, last_name: true } },
    },
  },
  hostel_rooms: {
    select: {
      id: true,
      room_number: true,
      capacity: true,
      hostel_id: true,
      block_id: true,
      hostels: { select: { id: true, name: true, code: true } },
      hostel_blocks: { select: { id: true, name: true } },
    },
  },
} satisfies Prisma.student_hostel_mappingInclude;

type MappingWithRelations = Prisma.student_hostel_mappingGetPayload<{
  include: typeof MAPPING_INCLUDE;
}>;

function toAllotmentResponse(mapping: MappingWithRelations) {
  const student = mapping.students;
  const name = student.soa_applications
    ? `${student.soa_applications.first_name} ${student.soa_applications.last_name ?? ''}`.trim()
    : `Student ${student.student_id_no}`;

  return {
    id: mapping.id,
    student: { id: student.id, name, student_id_no: student.student_id_no },
    room: {
      id: mapping.hostel_rooms.id,
      room_number: mapping.hostel_rooms.room_number,
      capacity: mapping.hostel_rooms.capacity,
    },
    hostel: mapping.hostel_rooms.hostels,
    block: mapping.hostel_rooms.hostel_blocks,
    fee_structure_id: mapping.fee_structure_id,
    allocated_date: mapping.allocated_date.toISOString().slice(0, 10),
  };
}

@Injectable()
export class AllotmentsService {
  private readonly logger = new Logger(AllotmentsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** GET /hostel-allotments?hostel_id=&block_id=&room_id=&page=&page_size= */
  async findAll(dto: SearchAllotmentsDto) {
    const { hostel_id, block_id, room_id, page = 1, page_size = 20 } = dto;

    const where: Prisma.student_hostel_mappingWhereInput = {};
    if (room_id) where.room_id = room_id;
    if (hostel_id || block_id) {
      where.hostel_rooms = {
        ...(hostel_id ? { hostel_id } : {}),
        ...(block_id ? { block_id } : {}),
      };
    }

    try {
      const [mappings, total] = await this.prisma.$transaction([
        this.prisma.student_hostel_mapping.findMany({
          where,
          include: MAPPING_INCLUDE,
          orderBy: { allocated_date: 'desc' },
          skip: (page - 1) * page_size,
          take: page_size,
        }),
        this.prisma.student_hostel_mapping.count({ where }),
      ]);

      return {
        page,
        page_size,
        total,
        data: mappings.map(toAllotmentResponse),
      };
    } catch (err) {
      this.logger.error('DB error while fetching hostel allotments', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * POST /hostel-allotments
   *
   * Error cases:
   *  404 STUDENT_NOT_FOUND        – student_id does not exist
   *  404 HOSTEL_ROOM_NOT_FOUND    – room_id does not exist
   *  409 STUDENT_ALREADY_ALLOTTED – student already has a current room
   *  409 ROOM_FULL                – room has no free capacity
   */
  async assign(dto: AssignAllotmentDto) {
    const student = await this.prisma.students.findUnique({
      where: { id: dto.student_id },
    });
    if (!student) {
      throw new NotFoundException({
        message: 'Student not found',
        errorCode: 'STUDENT_NOT_FOUND',
      });
    }

    const existingMapping = await this.prisma.student_hostel_mapping.findUnique(
      {
        where: { student_id: dto.student_id },
      },
    );
    if (existingMapping) {
      throw new ConflictException({
        message: 'Student already has a current hostel room allotment',
        errorCode: 'STUDENT_ALREADY_ALLOTTED',
      });
    }

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const room = await tx.hostel_rooms.findUnique({
          where: { id: dto.room_id },
          include: {
            _count: {
              select: {
                student_hostel_mapping: true,
                faculty_hostel_mapping: true,
              },
            },
          },
        });
        if (!room) {
          throw new NotFoundException({
            message: 'Hostel room not found',
            errorCode: 'HOSTEL_ROOM_NOT_FOUND',
          });
        }
        const occupied =
          room._count.student_hostel_mapping +
          room._count.faculty_hostel_mapping;
        if (occupied >= room.capacity) {
          throw new ConflictException({
            message: 'This room has no free capacity',
            errorCode: 'ROOM_FULL',
          });
        }

        return tx.student_hostel_mapping.create({
          data: {
            student_id: dto.student_id,
            room_id: dto.room_id,
            fee_structure_id: dto.fee_structure_id,
          },
          include: MAPPING_INCLUDE,
        });
      });
      return toAllotmentResponse(created);
    } catch (err) {
      if (
        err instanceof NotFoundException ||
        err instanceof ConflictException
      ) {
        throw err;
      }
      this.logger.error('DB error while assigning hostel allotment', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * PATCH /hostel-allotments/:student_id/shift
   *
   * Error cases:
   *  404 STUDENT_NOT_ALLOTTED  – student has no current allotment to shift
   *  404 HOSTEL_ROOM_NOT_FOUND – target room_id does not exist
   *  409 ROOM_FULL             – target room has no free capacity
   */
  async shift(studentId: number, dto: ShiftAllotmentDto) {
    const mapping = await this.prisma.student_hostel_mapping.findUnique({
      where: { student_id: studentId },
    });
    if (!mapping) {
      throw new NotFoundException({
        message: 'Student does not have a current hostel room allotment',
        errorCode: 'STUDENT_NOT_ALLOTTED',
      });
    }

    try {
      const updated = await this.prisma.$transaction(async (tx) => {
        const room = await tx.hostel_rooms.findUnique({
          where: { id: dto.room_id },
          include: {
            _count: {
              select: {
                student_hostel_mapping: true,
                faculty_hostel_mapping: true,
              },
            },
          },
        });
        if (!room) {
          throw new NotFoundException({
            message: 'Hostel room not found',
            errorCode: 'HOSTEL_ROOM_NOT_FOUND',
          });
        }
        const occupied =
          room._count.student_hostel_mapping +
          room._count.faculty_hostel_mapping;
        if (room.id !== mapping.room_id && occupied >= room.capacity) {
          throw new ConflictException({
            message: 'The target room has no free capacity',
            errorCode: 'ROOM_FULL',
          });
        }

        return tx.student_hostel_mapping.update({
          where: { student_id: studentId },
          data: { room_id: dto.room_id },
          include: MAPPING_INCLUDE,
        });
      });
      return toAllotmentResponse(updated);
    } catch (err) {
      if (
        err instanceof NotFoundException ||
        err instanceof ConflictException
      ) {
        throw err;
      }
      this.logger.error('DB error while shifting hostel allotment', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * DELETE /hostel-allotments/:student_id
   *
   * Direct admin-initiated vacate — distinct from the student-facing
   * quit-request approval flow, for admin corrections/removals.
   *
   * Error cases:
   *  404 STUDENT_NOT_ALLOTTED – student has no current allotment
   */
  async vacate(studentId: number) {
    const mapping = await this.prisma.student_hostel_mapping.findUnique({
      where: { student_id: studentId },
    });
    if (!mapping) {
      throw new NotFoundException({
        message: 'Student does not have a current hostel room allotment',
        errorCode: 'STUDENT_NOT_ALLOTTED',
      });
    }

    try {
      await this.prisma.student_hostel_mapping.delete({
        where: { student_id: studentId },
      });
      return { message: 'Student vacated from hostel room successfully' };
    } catch (err) {
      this.logger.error('DB error while vacating hostel allotment', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }
}
