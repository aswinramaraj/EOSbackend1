import { Injectable, InternalServerErrorException, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { Prisma } from '../../../generated/prisma/client';
import { detectMediaRoomSchema } from './media-room-schema.util';
import { CreateEquipmentDto } from './dto/create-equipment.dto';
import { UpdateEquipmentDto } from './dto/update-equipment.dto';

export interface EquipmentRow {
  id: number;
  asset_tag: string | null;
  name: string;
  category: string;
  serial_no: string | null;
  condition: string;
  status: string;
  checked_out_to: string | null;
  purchased_on: Date | null;
  invoice_value: string | null;
  warranty_till: Date | null;
  notes: string | null;
  created_at: Date;
}

export interface MovementRow {
  id: number;
  equipment_id: number;
  moved_at: Date;
  note: string;
}

const STATUS_VERB: Record<string, string> = {
  available: 'Marked available',
  checked_out: 'Checked out',
  in_service: 'Sent to service',
  retired: 'Retired',
};

const EQUIPMENT_COLUMNS = Prisma.sql`id, asset_tag, name, category, serial_no, condition, status, checked_out_to, purchased_on, invoice_value, warranty_till, notes, created_at`;

/** Equipment register — media_equipment + media_equipment_movements (new tables, not in schema.prisma). */
@Injectable()
export class MediaRoomEquipmentService {
  private readonly logger = new Logger(MediaRoomEquipmentService.name);

  constructor(private readonly prisma: PrismaService) {}

  async findAll() {
    const schema = await detectMediaRoomSchema(this.prisma);
    if (!schema.equipment) return { ready: false, data: [] };

    try {
      const rows = await this.prisma.$queryRaw<EquipmentRow[]>(Prisma.sql`
        SELECT ${EQUIPMENT_COLUMNS} FROM media_equipment ORDER BY category ASC, name ASC
      `);
      return { ready: true, data: rows };
    } catch (err) {
      this.logger.error('DB error listing media equipment', err);
      throw new InternalServerErrorException({ message: 'Something went wrong. Please try again.', errorCode: 'INTERNAL_ERROR' });
    }
  }

  async findOne(id: number) {
    const equipment = await this.findOneRaw(id);
    const schema = await detectMediaRoomSchema(this.prisma);
    let movements: MovementRow[] = [];
    if (schema.equipmentMovements) {
      movements = await this.prisma.$queryRaw<MovementRow[]>(Prisma.sql`
        SELECT id, equipment_id, moved_at, note FROM media_equipment_movements WHERE equipment_id = ${id} ORDER BY moved_at DESC
      `);
    }
    // The design's "Times issued" stat — every movement logged as a checkout (see STATUS_VERB.checked_out).
    const times_issued = movements.filter((m) => m.note.startsWith('Checked out')).length;
    return { ...equipment, movements, times_issued };
  }

  private async findOneRaw(id: number): Promise<EquipmentRow> {
    const rows = await this.prisma.$queryRaw<EquipmentRow[]>(Prisma.sql`
      SELECT ${EQUIPMENT_COLUMNS} FROM media_equipment WHERE id = ${id}
    `);
    if (rows.length === 0) throw new NotFoundException({ message: 'Equipment not found', errorCode: 'EQUIPMENT_NOT_FOUND' });
    return rows[0];
  }

  private async logMovement(equipmentId: number, note: string, userId: number) {
    const schema = await detectMediaRoomSchema(this.prisma);
    if (!schema.equipmentMovements) return;
    await this.prisma.$executeRaw(Prisma.sql`
      INSERT INTO media_equipment_movements (equipment_id, note, created_by_user_id) VALUES (${equipmentId}, ${note}, ${userId})
    `);
  }

  async create(dto: CreateEquipmentDto, userId: number) {
    try {
      const status = dto.status ?? 'available';
      const checkedOutTo = status === 'available' ? null : dto.checked_out_to ?? null;
      const rows = await this.prisma.$queryRaw<EquipmentRow[]>(Prisma.sql`
        INSERT INTO media_equipment (asset_tag, name, category, serial_no, condition, status, checked_out_to, purchased_on, invoice_value, warranty_till, notes, created_by_user_id)
        VALUES (${dto.asset_tag ?? null}, ${dto.name}, ${dto.category}, ${dto.serial_no ?? null}, ${dto.condition ?? 'good'}, ${status}, ${checkedOutTo}, ${dto.purchased_on ?? null}, ${dto.invoice_value ?? null}, ${dto.warranty_till ?? null}, ${dto.notes ?? null}, ${userId})
        RETURNING ${EQUIPMENT_COLUMNS}
      `);
      await this.logMovement(rows[0].id, 'Added to register', userId);
      return rows[0];
    } catch (err) {
      this.logger.error('DB error creating media equipment', err);
      throw new InternalServerErrorException({ message: 'Something went wrong. Please try again.', errorCode: 'INTERNAL_ERROR' });
    }
  }

  async update(id: number, dto: UpdateEquipmentDto, userId: number) {
    const existing = await this.findOneRaw(id);
    try {
      const rows = await this.prisma.$queryRaw<EquipmentRow[]>(Prisma.sql`
        UPDATE media_equipment SET
          asset_tag = COALESCE(${dto.asset_tag ?? null}, asset_tag),
          name = COALESCE(${dto.name ?? null}, name),
          category = COALESCE(${dto.category ?? null}, category),
          serial_no = COALESCE(${dto.serial_no ?? null}, serial_no),
          condition = COALESCE(${dto.condition ?? null}, condition),
          status = COALESCE(${dto.status ?? null}, status),
          checked_out_to = CASE WHEN ${dto.status ?? null} = 'available' THEN NULL ELSE COALESCE(${dto.checked_out_to ?? null}, checked_out_to) END,
          purchased_on = COALESCE(${dto.purchased_on ?? null}, purchased_on),
          invoice_value = COALESCE(${dto.invoice_value ?? null}, invoice_value),
          warranty_till = COALESCE(${dto.warranty_till ?? null}, warranty_till),
          notes = COALESCE(${dto.notes ?? null}, notes)
        WHERE id = ${id}
        RETURNING ${EQUIPMENT_COLUMNS}
      `);

      if (dto.status && dto.status !== existing.status) {
        const verb = STATUS_VERB[dto.status] ?? `Status changed to ${dto.status}`;
        const detail = dto.checked_out_to ? ` — ${dto.checked_out_to}` : '';
        await this.logMovement(id, `${verb}${detail}`, userId);
      } else if (dto.movement_note) {
        await this.logMovement(id, dto.movement_note, userId);
      }

      return rows[0];
    } catch (err) {
      this.logger.error(`DB error updating media equipment ${id}`, err);
      throw new InternalServerErrorException({ message: 'Something went wrong. Please try again.', errorCode: 'INTERNAL_ERROR' });
    }
  }

  async remove(id: number) {
    await this.findOneRaw(id);
    try {
      await this.prisma.$executeRaw(Prisma.sql`DELETE FROM media_equipment WHERE id = ${id}`);
      return { id };
    } catch (err) {
      this.logger.error(`DB error deleting media equipment ${id}`, err);
      throw new InternalServerErrorException({ message: 'Something went wrong. Please try again.', errorCode: 'INTERNAL_ERROR' });
    }
  }
}
