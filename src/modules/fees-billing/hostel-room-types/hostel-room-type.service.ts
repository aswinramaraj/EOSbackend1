import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateHostelRoomTypeDto } from './dto/create-hostel-room-type.dto';
import { UpdateHostelRoomTypeDto } from './dto/update-hostel-room-type.dto';

@Injectable()
export class HostelRoomTypeService {
  private readonly logger = new Logger(HostelRoomTypeService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * POST /hostel-room-types
   *
   * Error cases:
   *  409 HOSTEL_ROOM_TYPE_EXISTS – a room type with the same name already exists
   *  500 INTERNAL_ERROR          – unexpected failure (DB, etc.)
   */
  async create(dto: CreateHostelRoomTypeDto) {
    const existing = await this.findByName(dto.name);

    if (existing) {
      throw new ConflictException({
        message: 'A hostel room type with this name already exists',
        errorCode: 'HOSTEL_ROOM_TYPE_EXISTS',
      });
    }

    try {
      return await this.prisma.hostel_room_types.create({
        data: { name: dto.name },
      });
    } catch (err) {
      this.logger.error('DB error while creating hostel room type', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * GET /hostel-room-types
   */
  async findAll() {
    try {
      return await this.prisma.hostel_room_types.findMany({
        orderBy: { name: 'asc' },
      });
    } catch (err) {
      this.logger.error('DB error while fetching hostel room types', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * GET /hostel-room-types/:id
   *
   * Error cases:
   *  404 HOSTEL_ROOM_TYPE_NOT_FOUND – no room type with the given id
   */
  async findOne(id: number) {
    const roomType = await this.findById(id);

    if (!roomType) {
      throw new NotFoundException({
        message: 'Hostel room type not found',
        errorCode: 'HOSTEL_ROOM_TYPE_NOT_FOUND',
      });
    }

    return roomType;
  }

  /**
   * PUT/PATCH /hostel-room-types/:id
   *
   * Error cases:
   *  404 HOSTEL_ROOM_TYPE_NOT_FOUND – no room type with the given id
   *  409 HOSTEL_ROOM_TYPE_EXISTS    – another room type already uses this name
   */
  async update(id: number, dto: UpdateHostelRoomTypeDto) {
    const roomType = await this.findById(id);

    if (!roomType) {
      throw new NotFoundException({
        message: 'Hostel room type not found',
        errorCode: 'HOSTEL_ROOM_TYPE_NOT_FOUND',
      });
    }

    if (dto.name) {
      const existing = await this.findByName(dto.name);

      if (existing && existing.id !== id) {
        throw new ConflictException({
          message: 'A hostel room type with this name already exists',
          errorCode: 'HOSTEL_ROOM_TYPE_EXISTS',
        });
      }
    }

    try {
      return await this.prisma.hostel_room_types.update({
        where: { id },
        data: { name: dto.name },
      });
    } catch (err) {
      this.logger.error('DB error while updating hostel room type', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * DELETE /hostel-room-types/:id
   *
   * Error cases:
   *  404 HOSTEL_ROOM_TYPE_NOT_FOUND – no room type with the given id
   *  409 HOSTEL_ROOM_TYPE_IN_USE    – room type is referenced by hostel_rooms
   */
  async remove(id: number) {
    const roomType = await this.findById(id);

    if (!roomType) {
      throw new NotFoundException({
        message: 'Hostel room type not found',
        errorCode: 'HOSTEL_ROOM_TYPE_NOT_FOUND',
      });
    }

    let usageCount: number;

    try {
      usageCount = await this.prisma.hostel_rooms.count({
        where: { room_type_id: id },
      });
    } catch (err) {
      this.logger.error('DB error while checking hostel room type usage', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }

    if (usageCount > 0) {
      throw new ConflictException({
        message: 'This hostel room type is in use and cannot be deleted',
        errorCode: 'HOSTEL_ROOM_TYPE_IN_USE',
      });
    }

    try {
      return await this.prisma.hostel_room_types.delete({
        where: { id },
      });
    } catch (err) {
      this.logger.error('DB error while deleting hostel room type', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  private async findByName(name: string) {
    try {
      return await this.prisma.hostel_room_types.findUnique({
        where: { name },
      });
    } catch (err) {
      this.logger.error(
        'DB error during hostel room type duplicate check',
        err,
      );
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  private async findById(id: number) {
    try {
      return await this.prisma.hostel_room_types.findUnique({ where: { id } });
    } catch (err) {
      this.logger.error('DB error during hostel room type lookup', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }
}
