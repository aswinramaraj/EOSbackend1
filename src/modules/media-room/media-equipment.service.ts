import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import {
  CreateEquipmentDto,
  UpdateEquipmentDto,
} from './dto/media-equipment.dto';
import { dateOnly, instant, money, readyList } from './serialize';

/**
 * Columns the inventory UI reads. Selected explicitly so a later schema
 * addition never starts leaking into the API by accident.
 */
const EQUIPMENT_SELECT = {
  id: true,
  asset_tag: true,
  name: true,
  category: true,
  serial_no: true,
  condition: true,
  status: true,
  checked_out_to: true,
  purchased_on: true,
  invoice_value: true,
  warranty_till: true,
  notes: true,
  created_at: true,
} as const;

interface EquipmentRow {
  id: number;
  asset_tag: string | null;
  name: string;
  category: string;
  serial_no: string | null;
  condition: string;
  status: string;
  checked_out_to: string | null;
  purchased_on: Date | null;
  invoice_value: { toString(): string } | null;
  warranty_till: Date | null;
  notes: string | null;
  created_at: Date;
}

/**
 * A date-only column is stored at UTC midnight so it reads back as the same
 * calendar day everywhere, rather than shifting with the server's zone.
 */
function toDate(value: string | undefined): Date | undefined {
  return value === undefined ? undefined : new Date(value + 'T00:00:00.000Z');
}

function hasCode(err: unknown, code: string): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: unknown }).code === code
  );
}

@Injectable()
export class MediaEquipmentService {
  private readonly logger = new Logger(MediaEquipmentService.name);

  constructor(private readonly prisma: PrismaService) {}

  private shape(row: EquipmentRow) {
    return {
      id: row.id,
      asset_tag: row.asset_tag,
      name: row.name,
      category: row.category,
      serial_no: row.serial_no,
      condition: row.condition,
      status: row.status,
      checked_out_to: row.checked_out_to,
      purchased_on: dateOnly(row.purchased_on),
      invoice_value: money(row.invoice_value),
      warranty_till: dateOnly(row.warranty_till),
      notes: row.notes,
      created_at: instant(row.created_at),
    };
  }

  /** GET /me/media-equipment */
  async list() {
    const rows = await this.prisma.media_equipment.findMany({
      select: EQUIPMENT_SELECT,
      orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
    });
    return readyList(rows.map((r) => this.shape(r)));
  }

  /** GET /me/media-equipment/:id — includes the movement history. */
  async findOne(id: number) {
    const row = await this.prisma.media_equipment.findUnique({
      where: { id },
      select: {
        ...EQUIPMENT_SELECT,
        media_equipment_movements: {
          select: { id: true, equipment_id: true, moved_at: true, note: true },
          orderBy: [{ moved_at: 'desc' }, { id: 'desc' }],
          take: 100,
        },
      },
    });
    if (!row) {
      throw new NotFoundException({
        message: 'Equipment not found',
        errorCode: 'NOT_FOUND',
      });
    }
    const { media_equipment_movements, ...rest } = row;
    return {
      ...this.shape(rest),
      movements: media_equipment_movements.map((m) => ({
        id: m.id,
        equipment_id: m.equipment_id,
        moved_at: instant(m.moved_at),
        note: m.note,
      })),
    };
  }

  /** POST /me/media-equipment */
  async create(dto: CreateEquipmentDto, userId: number) {
    try {
      const row = await this.prisma.media_equipment.create({
        data: {
          asset_tag: dto.asset_tag,
          name: dto.name,
          category: dto.category,
          serial_no: dto.serial_no,
          purchased_on: toDate(dto.purchased_on),
          invoice_value: dto.invoice_value,
          warranty_till: toDate(dto.warranty_till),
          notes: dto.notes,
          created_by_user_id: userId,
        },
        select: EQUIPMENT_SELECT,
      });
      this.logger.log('Media equipment created: id=' + row.id + ' by user=' + userId);
      return this.shape(row);
    } catch (err) {
      // asset_tag is unique — a duplicate is a user error, not a server fault.
      if (hasCode(err, 'P2002')) {
        throw new ConflictException({
          message: 'That asset tag is already in use',
          errorCode: 'EQUIPMENT_ASSET_TAG_TAKEN',
        });
      }
      this.logger.error('DB error creating media equipment', err as Error);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * PATCH /me/media-equipment/:id
   *
   * The edit and its movement note are written in one transaction: a recorded
   * check-out whose history line went missing would leave the item's
   * whereabouts unexplained.
   */
  async update(id: number, dto: UpdateEquipmentDto, userId: number) {
    const { movement_note, ...fields } = dto;

    try {
      const row = await this.prisma.$transaction(async (tx) => {
        const updated = await tx.media_equipment.update({
          where: { id },
          data: {
            asset_tag: fields.asset_tag,
            name: fields.name,
            category: fields.category,
            serial_no: fields.serial_no,
            condition: fields.condition,
            status: fields.status,
            checked_out_to: fields.checked_out_to,
            purchased_on: toDate(fields.purchased_on),
            invoice_value: fields.invoice_value,
            warranty_till: toDate(fields.warranty_till),
            notes: fields.notes,
          },
          select: EQUIPMENT_SELECT,
        });

        if (movement_note) {
          await tx.media_equipment_movements.create({
            data: {
              equipment_id: id,
              note: movement_note,
              created_by_user_id: userId,
            },
          });
        }

        return updated;
      });

      this.logger.log(
        'Media equipment updated: id=' +
          id +
          ' by user=' +
          userId +
          (movement_note ? ' (movement logged)' : ''),
      );
      return this.shape(row);
    } catch (err) {
      if (hasCode(err, 'P2025')) {
        throw new NotFoundException({
          message: 'Equipment not found',
          errorCode: 'NOT_FOUND',
        });
      }
      if (hasCode(err, 'P2002')) {
        throw new ConflictException({
          message: 'That asset tag is already in use',
          errorCode: 'EQUIPMENT_ASSET_TAG_TAKEN',
        });
      }
      this.logger.error('DB error updating media equipment #' + id, err as Error);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /** DELETE /me/media-equipment/:id — movement rows cascade with the item. */
  async remove(id: number, userId: number) {
    try {
      await this.prisma.media_equipment.delete({ where: { id } });
      this.logger.log('Media equipment deleted: id=' + id + ' by user=' + userId);
      return { message: 'Equipment deleted successfully' };
    } catch (err) {
      if (hasCode(err, 'P2025')) {
        throw new NotFoundException({
          message: 'Equipment not found',
          errorCode: 'NOT_FOUND',
        });
      }
      // A shoot records issued gear as free text, so a real FK block here would
      // be unexpected — surface it rather than reporting a false success.
      if (hasCode(err, 'P2003')) {
        throw new ConflictException({
          message: 'This item is still referenced and cannot be deleted',
          errorCode: 'EQUIPMENT_IN_USE',
        });
      }
      this.logger.error('DB error deleting media equipment #' + id, err as Error);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }
}
