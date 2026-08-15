import { BadRequestException, Injectable, InternalServerErrorException, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { Prisma } from '../../../generated/prisma/client';
import type { CreateBillDto } from './dto/create-bill.dto';

interface ServiceRow {
  name: string;
  rate: string;
  note: string | null;
}

interface BillRow {
  id: number;
  patient_name: string;
  condition: string | null;
  attended_by_name: string | null;
  total: string;
  payment_mode: string;
  status: string;
  created_at: Date;
}

const MODE_LABEL: Record<string, string> = { cash: 'Cash', upi: 'UPI', student_account: 'Add to student account', staff_welfare: 'Staff welfare' };
const STATUS_LABEL: Record<string, string> = { paid: 'Paid', pending: 'Pending', settled: 'Settled' };

/** Billing — medical_bills/medical_bill_items (new, structured line items) + medical_services (fixed service-charge register). */
@Injectable()
export class MedicalCentreBillingService {
  private readonly logger = new Logger(MedicalCentreBillingService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getServices() {
    const rows = await this.prisma.$queryRaw<ServiceRow[]>(Prisma.sql`SELECT name, rate::text AS rate, note FROM medical_services ORDER BY id ASC`);
    return rows.map((r) => ({ name: r.name, rate: Number(r.rate), note: r.note ?? '' }));
  }

  async createBill(dto: CreateBillDto) {
    try {
      const medTotal = dto.items.filter((i) => i.item_type === 'medicine').reduce((sum, i) => sum + i.rate * i.quantity, 0);
      const svcTotal = dto.items.filter((i) => i.item_type === 'service').reduce((sum, i) => sum + i.rate * i.quantity, 0);
      const total = medTotal + svcTotal;

      for (const item of dto.items) {
        if (item.item_type === 'medicine' && item.stock_id != null) {
          const stock = await this.prisma.$queryRaw<{ quantity: number }[]>(Prisma.sql`SELECT quantity FROM pharmacy_stock WHERE id = ${item.stock_id}`);
          if (!stock[0] || stock[0].quantity < item.quantity) {
            throw new BadRequestException({ message: `Not enough stock for ${item.description}`, errorCode: 'INSUFFICIENT_STOCK' });
          }
        }
      }

      const billRows = await this.prisma.$queryRaw<{ id: number }[]>(Prisma.sql`
        INSERT INTO medical_bills (patient_name, patient_dept, condition, attended_by_staff_id, payment_mode, status, medicine_total, service_total, total)
        VALUES (${dto.patient_name}, ${dto.patient_dept ?? null}, ${dto.condition ?? null}, ${dto.attended_by_staff_id ?? null}, ${dto.payment_mode}, ${dto.status}, ${medTotal}, ${svcTotal}, ${total})
        RETURNING id
      `);
      const billId = billRows[0].id;

      for (const item of dto.items) {
        await this.prisma.$executeRaw(Prisma.sql`
          INSERT INTO medical_bill_items (bill_id, item_type, description, quantity, rate, amount)
          VALUES (${billId}, ${item.item_type}, ${item.description}, ${item.quantity}, ${item.rate}, ${item.rate * item.quantity})
        `);
        if (item.item_type === 'medicine' && item.stock_id != null) {
          await this.prisma.$executeRaw(Prisma.sql`UPDATE pharmacy_stock SET quantity = quantity - ${item.quantity} WHERE id = ${item.stock_id}`);
          await this.prisma.$executeRaw(Prisma.sql`INSERT INTO pharmacy_dispense_log (stock_id, quantity) VALUES (${item.stock_id}, ${item.quantity})`);
        }
      }

      return { id: billId, total };
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      this.logger.error('DB error creating bill', err);
      throw new InternalServerErrorException({ message: 'Something went wrong. Please try again.', errorCode: 'INTERNAL_ERROR' });
    }
  }

  async getHistory() {
    try {
      const rows = await this.prisma.$queryRaw<BillRow[]>(Prisma.sql`
        SELECT b.id, b.patient_name, b.condition, ms.name AS attended_by_name, b.total::text AS total, b.payment_mode, b.status, b.created_at
        FROM medical_bills b
        LEFT JOIN medical_staff ms ON ms.id = b.attended_by_staff_id
        ORDER BY b.created_at DESC LIMIT 50
      `);

      const bills = await Promise.all(
        rows.map(async (r) => {
          const items = await this.prisma.$queryRaw<{ description: string; quantity: number }[]>(Prisma.sql`
            SELECT description, quantity FROM medical_bill_items WHERE bill_id = ${r.id}
          `);
          return {
            id: `MB-${String(r.id).padStart(4, '0')}`,
            billId: r.id,
            patient: r.patient_name,
            condition: r.condition ?? '—',
            items: items.map((i) => `${i.description} x${i.quantity}`).join(' · ') || '—',
            staff: r.attended_by_name ?? '—',
            total: Number(r.total),
            mode: MODE_LABEL[r.payment_mode] ?? r.payment_mode,
            status: STATUS_LABEL[r.status] ?? r.status,
            when: r.created_at.toISOString(),
          };
        }),
      );

      const collected = bills.filter((b) => b.status === 'Paid').reduce((sum, b) => sum + b.total, 0);
      const pending = bills.filter((b) => b.status === 'Pending').reduce((sum, b) => sum + b.total, 0);

      return { bills, collected, pending };
    } catch (err) {
      this.logger.error('DB error listing bill history', err);
      throw new InternalServerErrorException({ message: 'Something went wrong. Please try again.', errorCode: 'INTERNAL_ERROR' });
    }
  }

  async collect(id: number) {
    try {
      const rows = await this.prisma.$queryRaw<{ id: number }[]>(Prisma.sql`
        UPDATE medical_bills SET status = 'paid' WHERE id = ${id} AND status = 'pending' RETURNING id
      `);
      if (rows.length === 0) throw new NotFoundException({ message: 'Pending bill not found', errorCode: 'BILL_NOT_FOUND' });
      return { id };
    } catch (err) {
      if (err instanceof NotFoundException) throw err;
      this.logger.error(`DB error collecting bill ${id}`, err);
      throw new InternalServerErrorException({ message: 'Something went wrong. Please try again.', errorCode: 'INTERNAL_ERROR' });
    }
  }
}
