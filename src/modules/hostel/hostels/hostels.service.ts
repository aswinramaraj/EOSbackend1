import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import type { Prisma } from 'generated/prisma/client';
import { CreateHostelDto } from './dto/create-hostel.dto';
import { UpdateHostelDto } from './dto/update-hostel.dto';
import { SearchHostelsDto } from './dto/search-hostels.dto';

const HOSTEL_INCLUDE = {
  hostel_rooms: {
    select: {
      capacity: true,
      _count: { select: { student_hostel_mapping: true } },
    },
  },
  users: { select: { id: true, email: true } },
} satisfies Prisma.hostelsInclude;

type HostelWithRelations = Prisma.hostelsGetPayload<{
  include: typeof HOSTEL_INCLUDE;
}>;

function toHostelResponse(hostel: HostelWithRelations) {
  const roomCount = hostel.hostel_rooms.length;
  const capacity = hostel.hostel_rooms.reduce((sum, r) => sum + r.capacity, 0);
  const occupied = hostel.hostel_rooms.reduce(
    (sum, r) => sum + r._count.student_hostel_mapping,
    0,
  );

  return {
    id: hostel.id,
    name: hostel.name,
    code: hostel.code,
    wing: hostel.wing,
    warden: hostel.users
      ? { id: hostel.users.id, email: hostel.users.email }
      : null,
    phone: hostel.phone,
    mess_type: hostel.mess_type,
    established_year: hostel.established_year,
    room_count: roomCount,
    capacity,
    occupied,
    vacant: capacity - occupied,
    occupancy_pct:
      capacity > 0 ? Math.round((occupied / capacity) * 1000) / 10 : 0,
  };
}

@Injectable()
export class HostelsService {
  private readonly logger = new Logger(HostelsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * POST /hostel/hostels
   *
   * Error cases:
   *  404 WARDEN_NOT_FOUND – warden_user_id does not exist
   *  409 HOSTEL_CODE_EXISTS – a hostel with this code already exists
   *  500 INTERNAL_ERROR – unexpected failure (DB, etc.)
   */
  async create(dto: CreateHostelDto) {
    if (dto.warden_user_id) {
      await this.assertWardenExists(dto.warden_user_id);
    }

    const existing = await this.findByCode(dto.code);
    if (existing) {
      throw new ConflictException({
        message: 'A hostel with this code already exists',
        errorCode: 'HOSTEL_CODE_EXISTS',
      });
    }

    try {
      const hostel = await this.prisma.hostels.create({
        data: {
          name: dto.name,
          code: dto.code,
          wing: dto.wing,
          warden_user_id: dto.warden_user_id,
          phone: dto.phone,
          mess_type: dto.mess_type,
          established_year: dto.established_year,
        },
        include: HOSTEL_INCLUDE,
      });
      return toHostelResponse(hostel);
    } catch (err) {
      this.logger.error('DB error while creating hostel', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /** GET /hostel/hostels */
  async findAll(dto: SearchHostelsDto) {
    const where: Prisma.hostelsWhereInput = {};
    if (dto.wing) where.wing = dto.wing;
    if (dto.q) {
      where.OR = [
        { name: { contains: dto.q, mode: 'insensitive' } },
        { code: { contains: dto.q, mode: 'insensitive' } },
      ];
    }

    try {
      const hostels = await this.prisma.hostels.findMany({
        where,
        include: HOSTEL_INCLUDE,
        orderBy: { name: 'asc' },
      });
      return hostels.map(toHostelResponse);
    } catch (err) {
      this.logger.error('DB error while fetching hostels', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * GET /hostel/hostels/:id
   *
   * Error cases:
   *  404 HOSTEL_NOT_FOUND – no hostel with the given id
   */
  async findOne(id: number) {
    const hostel = await this.findById(id);
    if (!hostel) {
      throw new NotFoundException({
        message: 'Hostel not found',
        errorCode: 'HOSTEL_NOT_FOUND',
      });
    }
    return toHostelResponse(hostel);
  }

  /**
   * PATCH /hostel/hostels/:id
   *
   * Error cases:
   *  404 HOSTEL_NOT_FOUND – no hostel with the given id
   *  404 WARDEN_NOT_FOUND – warden_user_id does not exist
   *  409 HOSTEL_CODE_EXISTS – another hostel already uses this code
   */
  async update(id: number, dto: UpdateHostelDto) {
    const hostel = await this.findById(id);
    if (!hostel) {
      throw new NotFoundException({
        message: 'Hostel not found',
        errorCode: 'HOSTEL_NOT_FOUND',
      });
    }

    if (dto.warden_user_id) {
      await this.assertWardenExists(dto.warden_user_id);
    }

    if (dto.code) {
      const existing = await this.findByCode(dto.code);
      if (existing && existing.id !== id) {
        throw new ConflictException({
          message: 'A hostel with this code already exists',
          errorCode: 'HOSTEL_CODE_EXISTS',
        });
      }
    }

    try {
      const updated = await this.prisma.hostels.update({
        where: { id },
        data: {
          name: dto.name,
          code: dto.code,
          wing: dto.wing,
          warden_user_id: dto.warden_user_id,
          phone: dto.phone,
          mess_type: dto.mess_type,
          established_year: dto.established_year,
        },
        include: HOSTEL_INCLUDE,
      });
      return toHostelResponse(updated);
    } catch (err) {
      this.logger.error('DB error while updating hostel', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * DELETE /hostel/hostels/:id
   *
   * Error cases:
   *  404 HOSTEL_NOT_FOUND – no hostel with the given id
   *  409 HOSTEL_IN_USE – hostel still has rooms assigned to it
   */
  async remove(id: number) {
    const hostel = await this.findById(id);
    if (!hostel) {
      throw new NotFoundException({
        message: 'Hostel not found',
        errorCode: 'HOSTEL_NOT_FOUND',
      });
    }

    if (hostel.hostel_rooms.length > 0) {
      throw new ConflictException({
        message: 'Cannot delete a hostel that still has rooms assigned to it',
        errorCode: 'HOSTEL_IN_USE',
      });
    }

    try {
      await this.prisma.hostels.delete({ where: { id } });
      return { message: 'Hostel deleted successfully' };
    } catch (err) {
      this.logger.error('DB error while deleting hostel', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  private async assertWardenExists(userId: number) {
    let user: unknown;
    try {
      user = await this.prisma.users.findUnique({ where: { id: userId } });
    } catch (err) {
      this.logger.error('DB error during warden lookup', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }

    if (!user) {
      throw new NotFoundException({
        message: 'Warden user not found',
        errorCode: 'WARDEN_NOT_FOUND',
      });
    }
  }

  private async findByCode(code: string) {
    try {
      return await this.prisma.hostels.findUnique({ where: { code } });
    } catch (err) {
      this.logger.error('DB error during hostel code duplicate check', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  private async findById(id: number) {
    try {
      return await this.prisma.hostels.findUnique({
        where: { id },
        include: HOSTEL_INCLUDE,
      });
    } catch (err) {
      this.logger.error('DB error during hostel lookup', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }
}
