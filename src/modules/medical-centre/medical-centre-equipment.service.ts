import { Injectable, InternalServerErrorException, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';

/** Equipment register — medical_equipment, a real Prisma model that predates this module. */
@Injectable()
export class MedicalCentreEquipmentService {
  private readonly logger = new Logger(MedicalCentreEquipmentService.name);

  constructor(private readonly prisma: PrismaService) {}

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
