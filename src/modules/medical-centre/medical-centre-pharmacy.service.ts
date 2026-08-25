import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { Prisma } from '../../../generated/prisma/client';
import { requireUpdateSet } from './medical-sql.util';
import type {
  CreateStockItemDto,
  UpdateStockItemDto,
} from './dto/medical-crud.dto';

interface StockRow {
  id: number;
  name: string;
  use_case: string | null;
  form: string | null;
  quantity: number;
  reorder_level: number;
  expiry_date: Date | null;
  rate: string;
}

/**
 * Pharmacy stock — pharmacy_stock + pharmacy_dispense_log.
 *
 * Full CRUD on the stock list, plus the two movement endpoints. Dispense and
 * restock stay separate from a plain edit so the dispense log keeps recording
 * only medicine that actually left the counter.
 */
@Injectable()
export class MedicalCentrePharmacyService {
  private readonly logger = new Logger(MedicalCentrePharmacyService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * POST /me/medical-centre-pharmacy — add a medicine line.
   *
   * Distinct from restock: this creates the line that did not exist before.
   */
  async createItem(dto: CreateStockItemDto) {
    try {
      const rows = await this.prisma.$queryRaw<{ id: number }[]>(Prisma.sql`
        INSERT INTO pharmacy_stock (name, use_case, form, quantity, reorder_level, expiry_date, rate)
        VALUES (
          ${dto.name},
          ${dto.use_case ?? null},
          ${dto.form ?? null},
          ${dto.quantity ?? 0},
          ${dto.reorder_level ?? 10},
          ${dto.expiry_date ? new Date(`${dto.expiry_date}T00:00:00.000Z`) : null},
          ${dto.rate ?? 0}
        )
        RETURNING id
      `);
      this.logger.log(`Pharmacy stock item created: id=${rows[0].id}`);
      return { id: rows[0].id };
    } catch (err) {
      this.logger.error('DB error creating pharmacy stock item', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * PATCH /me/medical-centre-pharmacy/:id
   *
   * A stock-take correction. Dispense and restock stay separate so the
   * dispense log remains an accurate record of what left the counter — an
   * edit here is explicitly not a dispensing event.
   */
  async updateItem(id: number, dto: UpdateStockItemDto) {
    const set = requireUpdateSet([
      { column: 'name', value: dto.name },
      { column: 'use_case', value: dto.use_case },
      { column: 'form', value: dto.form },
      { column: 'quantity', value: dto.quantity },
      { column: 'reorder_level', value: dto.reorder_level },
      {
        column: 'expiry_date',
        value: dto.expiry_date
          ? new Date(`${dto.expiry_date}T00:00:00.000Z`)
          : undefined,
      },
      { column: 'rate', value: dto.rate },
    ]);

    try {
      const rows = await this.prisma.$queryRaw<{ id: number }[]>(Prisma.sql`
        UPDATE pharmacy_stock SET ${set} WHERE id = ${id} RETURNING id
      `);
      if (rows.length === 0) {
        throw new NotFoundException({
          message: 'Stock item not found',
          errorCode: 'STOCK_ITEM_NOT_FOUND',
        });
      }
      this.logger.log(`Pharmacy stock item updated: id=${id}`);
      return { id };
    } catch (err) {
      if (err instanceof NotFoundException) throw err;
      this.logger.error('DB error updating pharmacy stock item', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * DELETE /me/medical-centre-pharmacy/:id
   *
   * Refused once the item has been dispensed: those log rows are a record of
   * medicine given to patients, and deleting the item they point at would
   * cascade that history away.
   */
  async deleteItem(id: number) {
    try {
      const dispensed = await this.prisma.pharmacy_dispense_log.count({
        where: { stock_id: id },
      });
      if (dispensed > 0) {
        throw new ConflictException({
          message: `This medicine has ${dispensed} dispensing record(s) against it, so it cannot be deleted. Set its quantity to 0 instead.`,
          errorCode: 'STOCK_ITEM_HAS_HISTORY',
        });
      }

      const rows = await this.prisma.$queryRaw<{ id: number }[]>(Prisma.sql`
        DELETE FROM pharmacy_stock WHERE id = ${id} RETURNING id
      `);
      if (rows.length === 0) {
        throw new NotFoundException({
          message: 'Stock item not found',
          errorCode: 'STOCK_ITEM_NOT_FOUND',
        });
      }
      this.logger.log(`Pharmacy stock item deleted: id=${id}`);
      return { id, message: 'Stock item deleted successfully' };
    } catch (err) {
      if (err instanceof NotFoundException || err instanceof ConflictException) throw err;
      this.logger.error('DB error deleting pharmacy stock item', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  async getStock() {
    try {
      const rows = await this.prisma.$queryRaw<StockRow[]>(Prisma.sql`
        SELECT id, name, use_case, form, quantity, reorder_level, expiry_date, rate::text AS rate
        FROM pharmacy_stock ORDER BY name ASC
      `);
      return rows.map((r) => ({
        id: r.id,
        name: r.name,
        use: r.use_case ?? '—',
        form: r.form ?? '—',
        qty: r.quantity,
        reorder: r.reorder_level,
        expiry: r.expiry_date ? r.expiry_date.toISOString().slice(0, 10) : null,
        rate: Number(r.rate),
      }));
    } catch (err) {
      this.logger.error('DB error listing pharmacy stock', err);
      throw new InternalServerErrorException({ message: 'Something went wrong. Please try again.', errorCode: 'INTERNAL_ERROR' });
    }
  }

  async dispense(id: number, quantity: number) {
    try {
      const rows = await this.prisma.$queryRaw<{ id: number; quantity: number }[]>(Prisma.sql`SELECT id, quantity FROM pharmacy_stock WHERE id = ${id}`);
      const stock = rows[0];
      if (!stock) throw new NotFoundException({ message: 'Medicine not found', errorCode: 'STOCK_NOT_FOUND' });
      if (stock.quantity < quantity) throw new BadRequestException({ message: 'Not enough stock', errorCode: 'INSUFFICIENT_STOCK' });

      await this.prisma.$executeRaw(Prisma.sql`UPDATE pharmacy_stock SET quantity = quantity - ${quantity} WHERE id = ${id}`);
      await this.prisma.$executeRaw(Prisma.sql`INSERT INTO pharmacy_dispense_log (stock_id, quantity) VALUES (${id}, ${quantity})`);
      return { id, quantity: stock.quantity - quantity };
    } catch (err) {
      if (err instanceof NotFoundException || err instanceof BadRequestException) throw err;
      this.logger.error(`DB error dispensing stock ${id}`, err);
      throw new InternalServerErrorException({ message: 'Something went wrong. Please try again.', errorCode: 'INTERNAL_ERROR' });
    }
  }

  async restock(id: number, quantity: number) {
    try {
      const rows = await this.prisma.$queryRaw<{ id: number }[]>(Prisma.sql`
        UPDATE pharmacy_stock SET quantity = quantity + ${quantity} WHERE id = ${id} RETURNING id
      `);
      if (rows.length === 0) throw new NotFoundException({ message: 'Medicine not found', errorCode: 'STOCK_NOT_FOUND' });
      return { id };
    } catch (err) {
      if (err instanceof NotFoundException) throw err;
      this.logger.error(`DB error restocking ${id}`, err);
      throw new InternalServerErrorException({ message: 'Something went wrong. Please try again.', errorCode: 'INTERNAL_ERROR' });
    }
  }
}
