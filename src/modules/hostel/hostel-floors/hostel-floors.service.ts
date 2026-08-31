import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import type { Prisma } from 'generated/prisma/client';
import { CreateHostelFloorDto } from './dto/create-hostel-floor.dto';
import { UpdateHostelFloorDto } from './dto/update-hostel-floor.dto';

const FLOOR_INCLUDE = {
  hostel_blocks: {
    select: {
      id: true,
      name: true,
      hostels: { select: { id: true, name: true, code: true } },
    },
  },
  hostel_rooms: {
    select: {
      capacity: true,
      student_hostel_mapping: { select: { student_id: true } },
    },
  },
} satisfies Prisma.hostel_floorsInclude;

type HostelFloorWithRelations = Prisma.hostel_floorsGetPayload<{
  include: typeof FLOOR_INCLUDE;
}>;

function toFloorResponse(floor: HostelFloorWithRelations) {
  const capacity = floor.hostel_rooms.reduce((sum, r) => sum + r.capacity, 0);
  const occupied = floor.hostel_rooms.reduce(
    (sum, r) => sum + r.student_hostel_mapping.length,
    0,
  );

  return {
    id: floor.id,
    block: {
      id: floor.hostel_blocks.id,
      name: floor.hostel_blocks.name,
      hostel: floor.hostel_blocks.hostels,
    },
    name: floor.name,
    rooms_count: floor.hostel_rooms.length,
    capacity,
    occupied,
    vacant: capacity - occupied,
    created_at: floor.created_at,
  };
}

/**
 * Admin's "manage hostel floors" screen — real `hostel_floors` table (added
 * this session, query.md #10). Mirrors HostelBlocksService one-for-one:
 * same real-vs-count distinction this table exists to fix (hostel_blocks.floors
 * was only ever a count, never individual floor records), same
 * @@unique(block_id, name) shape, same IN_USE delete guard.
 */
@Injectable()
export class HostelFloorsService {
  private readonly logger = new Logger(HostelFloorsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * POST /hostel/floors
   *
   * Error cases:
   *  404 HOSTEL_BLOCK_NOT_FOUND – block_id does not exist
   *  409 HOSTEL_FLOOR_EXISTS    – a floor with this name already exists in this block
   */
  async create(dto: CreateHostelFloorDto) {
    await this.assertBlockExists(dto.block_id);

    const existing = await this.findByBlockAndName(dto.block_id, dto.name);
    if (existing) {
      throw new ConflictException({
        message: 'A floor with this name already exists in this block',
        errorCode: 'HOSTEL_FLOOR_EXISTS',
      });
    }

    try {
      const floor = await this.prisma.hostel_floors.create({
        data: { block_id: dto.block_id, name: dto.name },
        include: FLOOR_INCLUDE,
      });
      return toFloorResponse(floor);
    } catch (err) {
      this.logger.error('DB error while creating hostel floor', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /** GET /hostel/floors?block_id= */
  async findAll(blockId?: number) {
    try {
      const floors = await this.prisma.hostel_floors.findMany({
        where: blockId ? { block_id: blockId } : {},
        include: FLOOR_INCLUDE,
        orderBy: [{ block_id: 'asc' }, { name: 'asc' }],
      });
      return floors.map(toFloorResponse);
    } catch (err) {
      this.logger.error('DB error while fetching hostel floors', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * GET /hostel/floors/:id
   *
   * Error cases:
   *  404 HOSTEL_FLOOR_NOT_FOUND – no floor with the given id
   */
  async findOne(id: number) {
    const floor = await this.findById(id);
    if (!floor) {
      throw new NotFoundException({
        message: 'Hostel floor not found',
        errorCode: 'HOSTEL_FLOOR_NOT_FOUND',
      });
    }
    return toFloorResponse(floor);
  }

  /**
   * PATCH /hostel/floors/:id
   *
   * Error cases:
   *  404 HOSTEL_FLOOR_NOT_FOUND – no floor with the given id
   *  409 HOSTEL_FLOOR_EXISTS    – another floor already uses this name in this block
   */
  async update(id: number, dto: UpdateHostelFloorDto) {
    const floor = await this.findById(id);
    if (!floor) {
      throw new NotFoundException({
        message: 'Hostel floor not found',
        errorCode: 'HOSTEL_FLOOR_NOT_FOUND',
      });
    }

    if (dto.name) {
      const existing = await this.findByBlockAndName(floor.block_id, dto.name);
      if (existing && existing.id !== id) {
        throw new ConflictException({
          message: 'A floor with this name already exists in this block',
          errorCode: 'HOSTEL_FLOOR_EXISTS',
        });
      }
    }

    try {
      const updated = await this.prisma.hostel_floors.update({
        where: { id },
        data: { name: dto.name },
        include: FLOOR_INCLUDE,
      });
      return toFloorResponse(updated);
    } catch (err) {
      this.logger.error('DB error while updating hostel floor', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * DELETE /hostel/floors/:id
   *
   * Error cases:
   *  404 HOSTEL_FLOOR_NOT_FOUND – no floor with the given id
   *  409 HOSTEL_FLOOR_IN_USE    – floor still has rooms assigned to it
   */
  async remove(id: number) {
    const floor = await this.findById(id);
    if (!floor) {
      throw new NotFoundException({
        message: 'Hostel floor not found',
        errorCode: 'HOSTEL_FLOOR_NOT_FOUND',
      });
    }

    if (floor.hostel_rooms.length > 0) {
      throw new ConflictException({
        message: 'Cannot delete a floor that still has rooms assigned to it',
        errorCode: 'HOSTEL_FLOOR_IN_USE',
      });
    }

    try {
      await this.prisma.hostel_floors.delete({ where: { id } });
      return { message: 'Hostel floor deleted successfully' };
    } catch (err) {
      this.logger.error('DB error while deleting hostel floor', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  private async assertBlockExists(blockId: number) {
    let block: unknown;
    try {
      block = await this.prisma.hostel_blocks.findUnique({
        where: { id: blockId },
      });
    } catch (err) {
      this.logger.error('DB error during hostel block lookup', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
    if (!block) {
      throw new NotFoundException({
        message: 'Hostel block not found',
        errorCode: 'HOSTEL_BLOCK_NOT_FOUND',
      });
    }
  }

  private async findByBlockAndName(blockId: number, name: string) {
    try {
      return await this.prisma.hostel_floors.findFirst({
        where: { block_id: blockId, name },
      });
    } catch (err) {
      this.logger.error('DB error during hostel floor duplicate check', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  private async findById(id: number) {
    try {
      return await this.prisma.hostel_floors.findUnique({
        where: { id },
        include: FLOOR_INCLUDE,
      });
    } catch (err) {
      this.logger.error('DB error during hostel floor lookup', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }
}
