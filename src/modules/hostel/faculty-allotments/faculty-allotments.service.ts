import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import type { Prisma } from 'generated/prisma/client';
import { AssignFacultyAllotmentDto } from './dto/assign-faculty-allotment.dto';
import { ShiftFacultyAllotmentDto } from './dto/shift-faculty-allotment.dto';
import { SearchFacultyAllotmentsDto } from './dto/search-faculty-allotments.dto';

const FACULTY_MAPPING_INCLUDE = {
  faculty: {
    select: { id: true, first_name: true, last_name: true, designation: true },
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
} satisfies Prisma.faculty_hostel_mappingInclude;

type FacultyMappingWithRelations = Prisma.faculty_hostel_mappingGetPayload<{
  include: typeof FACULTY_MAPPING_INCLUDE;
}>;

function toFacultyAllotmentResponse(mapping: FacultyMappingWithRelations) {
  const faculty = mapping.faculty;

  return {
    id: mapping.id,
    faculty: {
      id: faculty.id,
      name: `${faculty.first_name} ${faculty.last_name}`.trim(),
      designation: faculty.designation,
    },
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
export class FacultyAllotmentsService {
  private readonly logger = new Logger(FacultyAllotmentsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** GET /hostel-faculty-allotments?hostel_id=&block_id=&room_id=&page=&page_size= */
  async findAll(dto: SearchFacultyAllotmentsDto) {
    const { hostel_id, block_id, room_id, page = 1, page_size = 20 } = dto;

    const where: Prisma.faculty_hostel_mappingWhereInput = {};
    if (room_id) where.room_id = room_id;
    if (hostel_id || block_id) {
      where.hostel_rooms = {
        ...(hostel_id ? { hostel_id } : {}),
        ...(block_id ? { block_id } : {}),
      };
    }

    try {
      const [mappings, total] = await this.prisma.$transaction([
        this.prisma.faculty_hostel_mapping.findMany({
          where,
          include: FACULTY_MAPPING_INCLUDE,
          orderBy: { allocated_date: 'desc' },
          skip: (page - 1) * page_size,
          take: page_size,
        }),
        this.prisma.faculty_hostel_mapping.count({ where }),
      ]);

      return {
        page,
        page_size,
        total,
        data: mappings.map(toFacultyAllotmentResponse),
      };
    } catch (err) {
      this.logger.error(
        'DB error while fetching faculty hostel allotments',
        err,
      );
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * POST /hostel-faculty-allotments
   *
   * Error cases:
   *  404 FACULTY_NOT_FOUND        – faculty_id does not exist
   *  404 HOSTEL_ROOM_NOT_FOUND    – room_id does not exist
   *  409 FACULTY_ALREADY_ALLOTTED – faculty already has a current room
   *  409 ROOM_FULL                – room has no free capacity
   */
  async assign(dto: AssignFacultyAllotmentDto) {
    const faculty = await this.prisma.faculty.findUnique({
      where: { id: dto.faculty_id },
    });
    if (!faculty) {
      throw new NotFoundException({
        message: 'Faculty not found',
        errorCode: 'FACULTY_NOT_FOUND',
      });
    }

    const existingMapping = await this.prisma.faculty_hostel_mapping.findUnique(
      {
        where: { faculty_id: dto.faculty_id },
      },
    );
    if (existingMapping) {
      throw new ConflictException({
        message: 'Faculty already has a current hostel room allotment',
        errorCode: 'FACULTY_ALREADY_ALLOTTED',
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

        return tx.faculty_hostel_mapping.create({
          data: {
            faculty_id: dto.faculty_id,
            room_id: dto.room_id,
            fee_structure_id: dto.fee_structure_id,
          },
          include: FACULTY_MAPPING_INCLUDE,
        });
      });
      return toFacultyAllotmentResponse(created);
    } catch (err) {
      if (
        err instanceof NotFoundException ||
        err instanceof ConflictException
      ) {
        throw err;
      }
      this.logger.error(
        'DB error while assigning faculty hostel allotment',
        err,
      );
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * PATCH /hostel-faculty-allotments/:faculty_id/shift
   *
   * Error cases:
   *  404 FACULTY_NOT_ALLOTTED  – faculty has no current allotment to shift
   *  404 HOSTEL_ROOM_NOT_FOUND – target room_id does not exist
   *  409 ROOM_FULL             – target room has no free capacity
   */
  async shift(facultyId: number, dto: ShiftFacultyAllotmentDto) {
    const mapping = await this.prisma.faculty_hostel_mapping.findUnique({
      where: { faculty_id: facultyId },
    });
    if (!mapping) {
      throw new NotFoundException({
        message: 'Faculty does not have a current hostel room allotment',
        errorCode: 'FACULTY_NOT_ALLOTTED',
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

        return tx.faculty_hostel_mapping.update({
          where: { faculty_id: facultyId },
          data: { room_id: dto.room_id },
          include: FACULTY_MAPPING_INCLUDE,
        });
      });
      return toFacultyAllotmentResponse(updated);
    } catch (err) {
      if (
        err instanceof NotFoundException ||
        err instanceof ConflictException
      ) {
        throw err;
      }
      this.logger.error(
        'DB error while shifting faculty hostel allotment',
        err,
      );
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * DELETE /hostel-faculty-allotments/:faculty_id
   *
   * Error cases:
   *  404 FACULTY_NOT_ALLOTTED – faculty has no current allotment
   */
  async vacate(facultyId: number) {
    const mapping = await this.prisma.faculty_hostel_mapping.findUnique({
      where: { faculty_id: facultyId },
    });
    if (!mapping) {
      throw new NotFoundException({
        message: 'Faculty does not have a current hostel room allotment',
        errorCode: 'FACULTY_NOT_ALLOTTED',
      });
    }

    try {
      await this.prisma.faculty_hostel_mapping.delete({
        where: { faculty_id: facultyId },
      });
      return { message: 'Faculty vacated from hostel room successfully' };
    } catch (err) {
      this.logger.error(
        'DB error while vacating faculty hostel allotment',
        err,
      );
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }
}
