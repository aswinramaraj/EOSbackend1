import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import type {
  CreateMedicalEquipmentDto,
  UpdateMedicalEquipmentDto,
} from './dto/medical-crud.dto';

/** Equipment register — medical_equipment, a real Prisma model that predates this module. */
@Injectable()
export class MedicalCentreEquipmentService {
  private readonly logger = new Logger(MedicalCentreEquipmentService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** POST /me/medical-centre-equipment */
  async create(dto: CreateMedicalEquipmentDto) {
    try {
      const row = await this.prisma.medical_equipment.create({
        data: {
          name: dto.name,
          quantity: dto.quantity ?? 1,
          location: dto.location,
          condition: dto.condition ?? 'working',
        },
        select: { id: true },
      });
      this.logger.log(`Medical equipment created: id=${row.id}`);
      return { id: row.id };
    } catch (err) {
      this.logger.error('DB error creating medical equipment', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /** PATCH /me/medical-centre-equipment/:id */
  async update(id: number, dto: UpdateMedicalEquipmentDto) {
    if (
      dto.name === undefined &&
      dto.quantity === undefined &&
      dto.location === undefined &&
      dto.condition === undefined
    ) {
      throw new BadRequestException({
        message: 'No fields provided to update',
        errorCode: 'VALIDATION_ERROR',
      });
    }

    try {
      const row = await this.prisma.medical_equipment.update({
        where: { id },
        data: {
          name: dto.name,
          quantity: dto.quantity,
          location: dto.location,
          condition: dto.condition,
        },
        select: { id: true },
      });
      this.logger.log(`Medical equipment updated: id=${id}`);
      return { id: row.id };
    } catch (err) {
      if ((err as { code?: string }).code === 'P2025') {
        throw new NotFoundException({
          message: 'Equipment not found',
          errorCode: 'EQUIPMENT_NOT_FOUND',
        });
      }
      this.logger.error('DB error updating medical equipment', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /** DELETE /me/medical-centre-equipment/:id */
  async remove(id: number) {
    try {
      await this.prisma.medical_equipment.delete({ where: { id } });
      this.logger.log(`Medical equipment deleted: id=${id}`);
      return { id, message: 'Equipment deleted successfully' };
    } catch (err) {
      if ((err as { code?: string }).code === 'P2025') {
        throw new NotFoundException({
          message: 'Equipment not found',
          errorCode: 'EQUIPMENT_NOT_FOUND',
        });
      }
      this.logger.error('DB error deleting medical equipment', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  async findAll() {
    try {
      const rows = await this.prisma.medical_equipment.findMany({ orderBy: { name: 'asc' } });
      return rows.map((r) => ({
        id: r.id,
        name: r.name,
        qty: r.quantity,
        place: r.location ?? '—',
        condition: r.condition === 'working' ? 'Working' : 'Under service',
      }));
    } catch (err) {
      this.logger.error('DB error listing equipment', err);
      throw new InternalServerErrorException({ message: 'Something went wrong. Please try again.', errorCode: 'INTERNAL_ERROR' });
    }
  }

  async toggleCondition(id: number) {
    try {
      const item = await this.prisma.medical_equipment.findUnique({ where: { id } });
      if (!item) throw new NotFoundException({ message: 'Equipment not found', errorCode: 'EQUIPMENT_NOT_FOUND' });
      const next = item.condition === 'working' ? 'under_service' : 'working';
      await this.prisma.medical_equipment.update({ where: { id }, data: { condition: next } });
      return { id, condition: next === 'working' ? 'Working' : 'Under service' };
    } catch (err) {
      if (err instanceof NotFoundException) throw err;
      this.logger.error(`DB error toggling equipment ${id}`, err);
      throw new InternalServerErrorException({ message: 'Something went wrong. Please try again.', errorCode: 'INTERNAL_ERROR' });
    }
  }
}
