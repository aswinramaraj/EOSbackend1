import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import type { Prisma } from 'generated/prisma/client';
import { CreateWardenDto } from './dto/create-warden.dto';
import { UpdateWardenDto } from './dto/update-warden.dto';

const WARDEN_INCLUDE = {
  hostel_blocks: { select: { id: true, name: true, hostel_id: true } },
} satisfies Prisma.hostel_wardensInclude;

type WardenWithRelations = Prisma.hostel_wardensGetPayload<{
  include: typeof WARDEN_INCLUDE;
}>;

function toWardenResponse(warden: WardenWithRelations) {
  return {
    id: warden.id,
    user_id: warden.user_id,
    name: warden.name,
    emp_id: warden.emp_id,
    role: warden.role,
    gender: warden.gender,
    designation: warden.designation,
    block: warden.hostel_blocks,
    mobile: warden.mobile,
    email: warden.email,
    joined_date: warden.joined_date?.toISOString().slice(0, 10) ?? null,
    quarters: warden.quarters,
    created_at: warden.created_at.toISOString(),
  };
}

@Injectable()
export class WardensService {
  private readonly logger = new Logger(WardensService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * POST /hostel-wardens
   *
   * Error cases:
   *  404 BLOCK_NOT_FOUND – block_id does not exist
   *  409 WARDEN_EMP_ID_EXISTS – emp_id already used by another warden
   */
  async create(dto: CreateWardenDto) {
    if (dto.block_id) {
      await this.assertBlockExists(dto.block_id);
    }

    const existing = await this.findByEmpId(dto.emp_id);
    if (existing) {
      throw new ConflictException({
        message: 'A warden with this employee ID already exists',
        errorCode: 'WARDEN_EMP_ID_EXISTS',
      });
    }

    try {
      const warden = await this.prisma.hostel_wardens.create({
        data: {
          user_id: dto.user_id,
          name: dto.name,
          emp_id: dto.emp_id,
          role: dto.role,
          gender: dto.gender,
          designation: dto.designation,
          block_id: dto.block_id,
          mobile: dto.mobile,
          email: dto.email,
          joined_date: dto.joined_date ? new Date(dto.joined_date) : undefined,
          quarters: dto.quarters,
        },
        include: WARDEN_INCLUDE,
      });
      return toWardenResponse(warden);
    } catch (err) {
      this.logger.error('DB error while creating hostel warden', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /** GET /hostel-wardens?block_id= */
  async findAll(blockId?: number) {
    try {
      const wardens = await this.prisma.hostel_wardens.findMany({
        where: blockId ? { block_id: blockId } : {},
        include: WARDEN_INCLUDE,
        orderBy: { name: 'asc' },
      });
      return wardens.map(toWardenResponse);
    } catch (err) {
      this.logger.error('DB error while fetching hostel wardens', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * GET /hostel-wardens/:id
   *
   * Error cases:
   *  404 WARDEN_NOT_FOUND – no warden with the given id
   */
  async findOne(id: number) {
    const warden = await this.findById(id);
    if (!warden) {
      throw new NotFoundException({
        message: 'Warden not found',
        errorCode: 'WARDEN_NOT_FOUND',
      });
    }
    return toWardenResponse(warden);
  }

  /**
   * PATCH /hostel-wardens/:id
   *
   * Error cases:
   *  404 WARDEN_NOT_FOUND     – no warden with the given id
   *  404 BLOCK_NOT_FOUND      – block_id does not exist
   *  409 WARDEN_EMP_ID_EXISTS – another warden already uses this employee ID
   */
  async update(id: number, dto: UpdateWardenDto) {
    const warden = await this.findById(id);
    if (!warden) {
      throw new NotFoundException({
        message: 'Warden not found',
        errorCode: 'WARDEN_NOT_FOUND',
      });
    }

    if (dto.block_id) {
      await this.assertBlockExists(dto.block_id);
    }

    if (dto.emp_id) {
      const existing = await this.findByEmpId(dto.emp_id);
      if (existing && existing.id !== id) {
        throw new ConflictException({
          message: 'A warden with this employee ID already exists',
          errorCode: 'WARDEN_EMP_ID_EXISTS',
        });
      }
    }

    try {
      const updated = await this.prisma.hostel_wardens.update({
        where: { id },
        data: {
          user_id: dto.user_id,
          name: dto.name,
          emp_id: dto.emp_id,
          role: dto.role,
          gender: dto.gender,
          designation: dto.designation,
          block_id: dto.block_id,
          mobile: dto.mobile,
          email: dto.email,
          joined_date: dto.joined_date ? new Date(dto.joined_date) : undefined,
          quarters: dto.quarters,
          updated_at: new Date(),
        },
        include: WARDEN_INCLUDE,
      });
      return toWardenResponse(updated);
    } catch (err) {
      this.logger.error('DB error while updating hostel warden', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * DELETE /hostel-wardens/:id
   *
   * Error cases:
   *  404 WARDEN_NOT_FOUND – no warden with the given id
   *  409 WARDEN_IN_USE    – warden still has goods entries assigned
   */
  async remove(id: number) {
    const warden = await this.findById(id);
    if (!warden) {
      throw new NotFoundException({
        message: 'Warden not found',
        errorCode: 'WARDEN_NOT_FOUND',
      });
    }

    const goodsCount = await this.prisma.hostel_goods.count({
      where: { warden_id: id },
    });
    if (goodsCount > 0) {
      throw new ConflictException({
        message:
          'This warden still has goods entries assigned and cannot be deleted',
        errorCode: 'WARDEN_IN_USE',
      });
    }

    try {
      await this.prisma.hostel_wardens.delete({ where: { id } });
      return { message: 'Warden deleted successfully' };
    } catch (err) {
      this.logger.error('DB error while deleting hostel warden', err);
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
        errorCode: 'BLOCK_NOT_FOUND',
      });
    }
  }

  private async findByEmpId(empId: string) {
    try {
      return await this.prisma.hostel_wardens.findUnique({
        where: { emp_id: empId },
      });
    } catch (err) {
      this.logger.error('DB error during warden emp_id duplicate check', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  private async findById(id: number) {
    try {
      return await this.prisma.hostel_wardens.findUnique({
        where: { id },
        include: WARDEN_INCLUDE,
      });
    } catch (err) {
      this.logger.error('DB error during hostel warden lookup', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }
}
