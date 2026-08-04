import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateHostelRoomDto } from './dto/create-hostel-room.dto';
import { UpdateHostelRoomDto } from './dto/update-hostel-room.dto';

function toRoomResponse(room: {
  id: number;
  hostel_id: number;
  room_number: string;
  room_type_id: number;
  capacity: number;
  _count: { student_hostel_mapping: number };
}) {
  return {
    id: room.id,
    hostel_id: room.hostel_id,
    room_number: room.room_number,
    room_type_id: room.room_type_id,
    capacity: room.capacity,
    occupied: room._count.student_hostel_mapping,
    vacant: room.capacity - room._count.student_hostel_mapping,
  };
}

@Injectable()
export class HostelRoomService {
  private readonly logger = new Logger(HostelRoomService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * POST /hostel-rooms
   *
   * Error cases:
   *  404 HOSTEL_NOT_FOUND           – hostel_id does not exist
   *  404 HOSTEL_ROOM_TYPE_NOT_FOUND – room_type_id does not exist
   *  409 HOSTEL_ROOM_EXISTS         – a room with the same room_number already exists in this hostel
   *  500 INTERNAL_ERROR             – unexpected failure (DB, etc.)
   */
  async create(dto: CreateHostelRoomDto) {
    await this.assertHostelExists(dto.hostel_id);
    await this.assertRoomTypeExists(dto.room_type_id);

    const existing = await this.findByHostelAndRoomNumber(
      dto.hostel_id,
      dto.room_number,
    );

    if (existing) {
      throw new ConflictException({
        message:
          'A hostel room with this room number already exists in this hostel',
        errorCode: 'HOSTEL_ROOM_EXISTS',
      });
    }

    try {
      const room = await this.prisma.hostel_rooms.create({
        data: {
          hostel_id: dto.hostel_id,
          room_number: dto.room_number,
          room_type_id: dto.room_type_id,
          capacity: dto.capacity,
        },
        include: { _count: { select: { student_hostel_mapping: true } } },
      });
      return toRoomResponse(room);
    } catch (err) {
      this.logger.error('DB error while creating hostel room', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * GET /hostel-rooms?hostel_id=
   */
  async findAll(hostelId?: number) {
    try {
      const rooms = await this.prisma.hostel_rooms.findMany({
        where: hostelId ? { hostel_id: hostelId } : {},
        include: { _count: { select: { student_hostel_mapping: true } } },
        orderBy: { room_number: 'asc' },
      });
      return rooms.map(toRoomResponse);
    } catch (err) {
      this.logger.error('DB error while fetching hostel rooms', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * GET /hostel-rooms/:id
   *
   * Error cases:
   *  404 HOSTEL_ROOM_NOT_FOUND – no room with the given id
   */
  async findOne(id: number) {
    const room = await this.findById(id);

    if (!room) {
      throw new NotFoundException({
        message: 'Hostel room not found',
        errorCode: 'HOSTEL_ROOM_NOT_FOUND',
      });
    }

    return toRoomResponse(room);
  }

  /**
   * PUT/PATCH /hostel-rooms/:id
   *
   * Error cases:
   *  404 HOSTEL_ROOM_NOT_FOUND      – no room with the given id
   *  404 HOSTEL_NOT_FOUND           – hostel_id does not exist
   *  404 HOSTEL_ROOM_TYPE_NOT_FOUND – room_type_id does not exist
   *  409 HOSTEL_ROOM_EXISTS         – another room already uses this room_number in this hostel
   */
  async update(id: number, dto: UpdateHostelRoomDto) {
    const room = await this.findById(id);

    if (!room) {
      throw new NotFoundException({
        message: 'Hostel room not found',
        errorCode: 'HOSTEL_ROOM_NOT_FOUND',
      });
    }

    if (dto.hostel_id) {
      await this.assertHostelExists(dto.hostel_id);
    }

    if (dto.room_type_id) {
      await this.assertRoomTypeExists(dto.room_type_id);
    }

    if (dto.room_number || dto.hostel_id) {
      const effectiveHostelId = dto.hostel_id ?? room.hostel_id;
      const effectiveRoomNumber = dto.room_number ?? room.room_number;
      const existing = await this.findByHostelAndRoomNumber(
        effectiveHostelId,
        effectiveRoomNumber,
      );

      if (existing && existing.id !== id) {
        throw new ConflictException({
          message:
            'A hostel room with this room number already exists in this hostel',
          errorCode: 'HOSTEL_ROOM_EXISTS',
        });
      }
    }

    try {
      const updated = await this.prisma.hostel_rooms.update({
        where: { id },
        data: {
          hostel_id: dto.hostel_id,
          room_number: dto.room_number,
          room_type_id: dto.room_type_id,
          capacity: dto.capacity,
        },
        include: { _count: { select: { student_hostel_mapping: true } } },
      });
      return toRoomResponse(updated);
    } catch (err) {
      this.logger.error('DB error while updating hostel room', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * DELETE /hostel-rooms/:id
   *
   * Error cases:
   *  404 HOSTEL_ROOM_NOT_FOUND – no room with the given id
   *  409 HOSTEL_ROOM_IN_USE    – room is referenced by student_hostel_mapping
   */
  async remove(id: number) {
    const room = await this.findById(id);

    if (!room) {
      throw new NotFoundException({
        message: 'Hostel room not found',
        errorCode: 'HOSTEL_ROOM_NOT_FOUND',
      });
    }

    if (room._count.student_hostel_mapping > 0) {
      throw new ConflictException({
        message: 'This hostel room is in use and cannot be deleted',
        errorCode: 'HOSTEL_ROOM_IN_USE',
      });
    }

    try {
      await this.prisma.hostel_rooms.delete({ where: { id } });
      return { message: 'Hostel room deleted successfully' };
    } catch (err) {
      this.logger.error('DB error while deleting hostel room', err);
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

  private async assertRoomTypeExists(roomTypeId: number) {
    let roomType: unknown;

    try {
      roomType = await this.prisma.hostel_room_types.findUnique({
        where: { id: roomTypeId },
      });
    } catch (err) {
      this.logger.error('DB error during hostel room type lookup', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }

    if (!roomType) {
      throw new NotFoundException({
        message: 'Hostel room type not found',
        errorCode: 'HOSTEL_ROOM_TYPE_NOT_FOUND',
      });
    }
  }

  private async findByHostelAndRoomNumber(
    hostelId: number,
    roomNumber: string,
  ) {
    try {
      return await this.prisma.hostel_rooms.findFirst({
        where: { hostel_id: hostelId, room_number: roomNumber },
      });
    } catch (err) {
      this.logger.error('DB error during hostel room duplicate check', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  private async findById(id: number) {
    try {
      return await this.prisma.hostel_rooms.findUnique({
        where: { id },
        include: { _count: { select: { student_hostel_mapping: true } } },
      });
    } catch (err) {
      this.logger.error('DB error during hostel room lookup', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }
}
