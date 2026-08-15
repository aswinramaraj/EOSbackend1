import { BadRequestException, Injectable, InternalServerErrorException, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { Prisma } from '../../../generated/prisma/client';

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

/** Pharmacy stock — pharmacy_stock + pharmacy_dispense_log (new tables). No "add medicine" control exists in the design; stock is seeded and adjusted via dispense/restock. */
@Injectable()
export class MedicalCentrePharmacyService {
  private readonly logger = new Logger(MedicalCentrePharmacyService.name);

  constructor(private readonly prisma: PrismaService) {}

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
