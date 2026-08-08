import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateBlockDto } from './dto/create-block.dto';
import { UpdateBlockDto } from './dto/update-block.dto';

function toBlockResponse(block: {
  id: number;
  hostel_id: number;
  name: string;
  floors: number;
  created_at: Date;
  hostels: { name: string; wing: string };
  hostel_wardens: { name: string }[];
  hostel_rooms: {
    capacity: number;
    _count: { student_hostel_mapping: number; faculty_hostel_mapping: number };
  }[];
  _count: {
    hostel_rooms: number;
    hostel_wardens: number;
    hostel_goods: number;
  };
}) {
  const total_beds = block.hostel_rooms.reduce((sum, r) => sum + r.capacity, 0);
  const occupied_beds = block.hostel_rooms.reduce(
    (sum, r) => sum + r._count.student_hostel_mapping + r._count.faculty_hostel_mapping,
    0,
  );

  return {
    id: block.id,
    hostel_id: block.hostel_id,
    hostel_name: block.hostels.name,
    hostel_wing: block.hostels.wing,
    name: block.name,
    floors: block.floors,
    room_count: block._count.hostel_rooms,
    warden_count: block._count.hostel_wardens,
    warden_names: block.hostel_wardens.map((w) => w.name),
    total_beds,
    occupied_beds,
    available_beds: total_beds - occupied_beds,
    created_at: block.created_at.toISOString(),
  };
}

const BLOCK_INCLUDE = {
  hostels: { select: { name: true, wing: true } },
  hostel_wardens: { select: { name: true } },
  hostel_rooms: {
    select: {
      capacity: true,
      _count: { select: { student_hostel_mapping: true, faculty_hostel_mapping: true } },
    },
  },
  _count: {
    select: { hostel_rooms: true, hostel_wardens: true, hostel_goods: true },
  },
} as const;

@Injectable()
export class BlocksService {
  private readonly logger = new Logger(BlocksService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * POST /hostel-blocks
   *
   * Error cases:
   *  404 HOSTEL_NOT_FOUND  – hostel_id does not exist
   *  409 BLOCK_EXISTS      – a block with this name already exists in this hostel
   */
  async create(dto: CreateBlockDto) {
    await this.assertHostelExists(dto.hostel_id);

    const existing = await this.findByHostelAndName(dto.hostel_id, dto.name);
    if (existing) {
      throw new ConflictException({
        message: 'A block with this name already exists in this hostel',
        errorCode: 'BLOCK_EXISTS',
      });
    }

    try {
      const block = await this.prisma.hostel_blocks.create({
        data: {
          hostel_id: dto.hostel_id,
          name: dto.name,
          floors: dto.floors,
        },
        include: BLOCK_INCLUDE,
      });
      return toBlockResponse(block);
    } catch (err) {
      this.logger.error('DB error while creating hostel block', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /** GET /hostel-blocks?hostel_id= */
  async findAll(hostelId?: number) {
    try {
      const blocks = await this.prisma.hostel_blocks.findMany({
        where: hostelId ? { hostel_id: hostelId } : {},
        include: BLOCK_INCLUDE,
        orderBy: { name: 'asc' },
      });
      return blocks.map(toBlockResponse);
    } catch (err) {
      this.logger.error('DB error while fetching hostel blocks', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * GET /hostel-blocks/:id
   *
   * Error cases:
   *  404 BLOCK_NOT_FOUND – no block with the given id
   */
  async findOne(id: number) {
    const block = await this.findById(id);
    if (!block) {
      throw new NotFoundException({
        message: 'Hostel block not found',
        errorCode: 'BLOCK_NOT_FOUND',
      });
    }
    return toBlockResponse(block);
  }

  /**
   * PATCH /hostel-blocks/:id
   *
   * Error cases:
   *  404 BLOCK_NOT_FOUND  – no block with the given id
   *  404 HOSTEL_NOT_FOUND – hostel_id does not exist
   *  409 BLOCK_EXISTS     – another block already uses this name in this hostel
   */
  async update(id: number, dto: UpdateBlockDto) {
    const block = await this.findById(id);
    if (!block) {
      throw new NotFoundException({
        message: 'Hostel block not found',
        errorCode: 'BLOCK_NOT_FOUND',
      });
    }

    if (dto.hostel_id) {
      await this.assertHostelExists(dto.hostel_id);
    }

    if (dto.name || dto.hostel_id) {
      const effectiveHostelId = dto.hostel_id ?? block.hostel_id;
      const effectiveName = dto.name ?? block.name;
      const existing = await this.findByHostelAndName(
        effectiveHostelId,
        effectiveName,
      );
      if (existing && existing.id !== id) {
        throw new ConflictException({
          message: 'A block with this name already exists in this hostel',
          errorCode: 'BLOCK_EXISTS',
        });
      }
    }

    try {
      const updated = await this.prisma.hostel_blocks.update({
        where: { id },
        data: {
          hostel_id: dto.hostel_id,
          name: dto.name,
          floors: dto.floors,
          updated_at: new Date(),
        },
        include: BLOCK_INCLUDE,
      });
      return toBlockResponse(updated);
    } catch (err) {
      this.logger.error('DB error while updating hostel block', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * DELETE /hostel-blocks/:id
   *
   * Error cases:
   *  404 BLOCK_NOT_FOUND – no block with the given id
   *  409 BLOCK_IN_USE    – block still has rooms or wardens assigned
   */
  async remove(id: number) {
    const block = await this.findById(id);
    if (!block) {
      throw new NotFoundException({
        message: 'Hostel block not found',
        errorCode: 'BLOCK_NOT_FOUND',
      });
    }

    if (
      block._count.hostel_rooms > 0 ||
      block._count.hostel_wardens > 0 ||
      block._count.hostel_goods > 0
    ) {
      throw new ConflictException({
        message:
          'This block still has rooms, wardens, or goods entries assigned and cannot be deleted',
        errorCode: 'BLOCK_IN_USE',
      });
    }

    try {
      await this.prisma.hostel_blocks.delete({ where: { id } });
      return { message: 'Hostel block deleted successfully' };
    } catch (err) {
      this.logger.error('DB error while deleting hostel block', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  private async assertHostelExists(hostelId: number) {
    let hostel: unknown;
    try {
      hostel = await this.prisma.hostels.findUnique({
        where: { id: hostelId },
      });
    } catch (err) {
      this.logger.error('DB error during hostel lookup', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }

    if (!hostel) {
      throw new NotFoundException({
        message: 'Hostel not found',
        errorCode: 'HOSTEL_NOT_FOUND',
      });
    }
  }

  private async findByHostelAndName(hostelId: number, name: string) {
    try {
      return await this.prisma.hostel_blocks.findFirst({
        where: { hostel_id: hostelId, name },
      });
    } catch (err) {
      this.logger.error('DB error during hostel block duplicate check', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  private async findById(id: number) {
    try {
      return await this.prisma.hostel_blocks.findUnique({
        where: { id },
        include: BLOCK_INCLUDE,
      });
    } catch (err) {
      this.logger.error('DB error during hostel block lookup', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }
}
