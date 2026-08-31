import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import type { Prisma } from 'generated/prisma/client';
import { CreateHostelBlockDto } from './dto/create-hostel-block.dto';
import { UpdateHostelBlockDto } from './dto/update-hostel-block.dto';

const BLOCK_INCLUDE = {
  hostels: { select: { id: true, name: true, code: true } },
  hostel_wardens: { select: { id: true, name: true, role: true } },
  hostel_rooms: {
    select: {
      capacity: true,
      student_hostel_mapping: { select: { student_id: true } },
    },
  },
} satisfies Prisma.hostel_blocksInclude;

type HostelBlockWithRelations = Prisma.hostel_blocksGetPayload<{
  include: typeof BLOCK_INCLUDE;
}>;

/**
 * If a block has more than one warden row, super_warden is preferred for
 * display over sub_warden — same precedent PrincipalHostelService.blocks()
 * already established for this exact ambiguity.
 */
function toBlockResponse(block: HostelBlockWithRelations) {
  const capacity = block.hostel_rooms.reduce((sum, r) => sum + r.capacity, 0);
  const occupied = block.hostel_rooms.reduce(
    (sum, r) => sum + r.student_hostel_mapping.length,
    0,
  );
  const warden =
    block.hostel_wardens.find((w) => w.role === 'super_warden') ??
    block.hostel_wardens[0] ??
    null;

  return {
    id: block.id,
    hostel: block.hostels,
    name: block.name,
    floors: block.floors,
    warden: warden
      ? { id: warden.id, name: warden.name, role: warden.role }
      : null,
    /** Full roster for this block (both super_warden and sub_warden rows) — `warden` above stays the single preferred one for compact list display. */
    wardens: block.hostel_wardens.map((w) => ({
      id: w.id,
      name: w.name,
      role: w.role,
    })),
    rooms_count: block.hostel_rooms.length,
    capacity,
    occupied,
    vacant: capacity - occupied,
    created_at: block.created_at,
  };
}

/**
 * Admin's "manage hostel blocks" screen — real `hostel_blocks` table, which
 * existed already (FK-linked from hostel_rooms.block_id, hostel_wardens.block_id,
 * hostel_goods.block_id) but had zero create/update/delete anywhere in the
 * app before this — every prior reader (PrincipalHostelService.blocks(),
 * the older principal-hostel module) only ever listed blocks that someone
 * had inserted directly via SQL/seed.
 */
@Injectable()
export class HostelBlocksService {
  private readonly logger = new Logger(HostelBlocksService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * POST /hostel/blocks
   *
   * Error cases:
   *  404 HOSTEL_NOT_FOUND      – hostel_id does not exist
   *  409 HOSTEL_BLOCK_EXISTS   – a block with this name already exists in this hostel
   *  500 INTERNAL_ERROR        – unexpected failure (DB, etc.)
   */
  async create(dto: CreateHostelBlockDto) {
    await this.assertHostelExists(dto.hostel_id);

    const existing = await this.findByHostelAndName(dto.hostel_id, dto.name);
    if (existing) {
      throw new ConflictException({
        message: 'A block with this name already exists in this hostel',
        errorCode: 'HOSTEL_BLOCK_EXISTS',
      });
    }

    try {
      const block = await this.prisma.hostel_blocks.create({
        data: { hostel_id: dto.hostel_id, name: dto.name, floors: dto.floors },
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

  /** GET /hostel/blocks?hostel_id= */
  async findAll(hostelId?: number) {
    try {
      const blocks = await this.prisma.hostel_blocks.findMany({
        where: hostelId ? { hostel_id: hostelId } : {},
        include: BLOCK_INCLUDE,
        orderBy: [{ hostel_id: 'asc' }, { name: 'asc' }],
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
   * GET /hostel/blocks/:id
   *
   * Error cases:
   *  404 HOSTEL_BLOCK_NOT_FOUND – no block with the given id
   */
  async findOne(id: number) {
    const block = await this.findById(id);
    if (!block) {
      throw new NotFoundException({
        message: 'Hostel block not found',
        errorCode: 'HOSTEL_BLOCK_NOT_FOUND',
      });
    }
    return toBlockResponse(block);
  }

  /**
   * PATCH /hostel/blocks/:id
   *
   * Error cases:
   *  404 HOSTEL_BLOCK_NOT_FOUND – no block with the given id
   *  409 HOSTEL_BLOCK_EXISTS    – another block already uses this name in this hostel
   */
  async update(id: number, dto: UpdateHostelBlockDto) {
    const block = await this.findById(id);
    if (!block) {
      throw new NotFoundException({
        message: 'Hostel block not found',
        errorCode: 'HOSTEL_BLOCK_NOT_FOUND',
      });
    }

    if (dto.name) {
      const existing = await this.findByHostelAndName(
        block.hostel_id,
        dto.name,
      );
      if (existing && existing.id !== id) {
        throw new ConflictException({
          message: 'A block with this name already exists in this hostel',
          errorCode: 'HOSTEL_BLOCK_EXISTS',
        });
      }
    }

    try {
      const updated = await this.prisma.hostel_blocks.update({
        where: { id },
        data: { name: dto.name, floors: dto.floors },
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
   * DELETE /hostel/blocks/:id
   *
   * Error cases:
   *  404 HOSTEL_BLOCK_NOT_FOUND – no block with the given id
   *  409 HOSTEL_BLOCK_IN_USE    – block still has rooms assigned to it
   */
  async remove(id: number) {
    const block = await this.findById(id);
    if (!block) {
      throw new NotFoundException({
        message: 'Hostel block not found',
        errorCode: 'HOSTEL_BLOCK_NOT_FOUND',
      });
    }

    if (block.hostel_rooms.length > 0) {
      throw new ConflictException({
        message: 'Cannot delete a block that still has rooms assigned to it',
        errorCode: 'HOSTEL_BLOCK_IN_USE',
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
