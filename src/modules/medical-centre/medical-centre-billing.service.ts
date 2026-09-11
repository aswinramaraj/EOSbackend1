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
        INSERT INTO medical_bills (patient_name, patient_dept, condition, attended_by_staff_id, payment_mode, status, medicine_total, service_total, total, upi_transaction_id, visit_id)
        VALUES (${dto.patient_name}, ${dto.patient_dept ?? null}, ${dto.condition ?? null}, ${dto.attended_by_staff_id ?? null}, ${dto.payment_mode}, ${dto.status}, ${medTotal}, ${svcTotal}, ${total},
                ${dto.payment_mode === 'upi' ? (dto.upi_transaction_id ?? null) : null},
                ${dto.visit_id ?? null}::int)
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

  /**
   * GET /me/medical-centre-billing/:id/receipt
   *
   * Everything the printed receipt needs, in one read: the patient block, the
   * reason for the visit, and the line items as real rows (description,
   * quantity, unit rate, line amount) rather than the pre-joined summary
   * string `getHistory` returns for the on-screen list.
   *
   * `medical_bills` holds the patient as free text (`patient_name`,
   * `patient_dept`) with no FK to `students`, so no roll number exists to
   * print for a bill. The receipt shows what was actually recorded rather
   * than guessing a student by name.
   */
  async getReceipt(id: number) {
    // Raw SQL rather than the Prisma model: `upi_transaction_id` is a plain
    // column on medical_bills that is not present in schema.prisma (that file
    // is owned by the DB owner and not edited from here), so there is no
    // generated field to select. The rest of this module already reads this way.
    const bills = await this.prisma.$queryRaw<
      {
        id: number;
        patient_name: string;
        patient_dept: string | null;
        condition: string | null;
        payment_mode: string;
        upi_transaction_id: string | null;
        status: string;
        medicine_total: string;
        service_total: string;
        total: string;
        created_at: Date;
        staff_name: string | null;
        staff_designation: string | null;
        linked_name: string | null;
        linked_identifier: string | null;
        linked_department: string | null;
        visit_id: number | null;
      }[]
    >(Prisma.sql`
      SELECT b.id, b.patient_name, b.patient_dept, b.condition,
             b.payment_mode, b.upi_transaction_id, b.status,
             b.medicine_total::text AS medicine_total,
             b.service_total::text  AS service_total,
             b.total::text          AS total,
             b.created_at,
             ms.name        AS staff_name,
             ms.designation AS staff_designation,
             -- Identity resolved through the visit rather than the free-text
             -- patient_name: a student is named on soa_applications and carries
             -- a roll number on students, a faculty patient carries a staff
             -- code. Null for a walk-in billed with no queue entry.
             COALESCE(
               NULLIF(TRIM(CONCAT_WS(' ', sa.first_name, sa.last_name)), ''),
               NULLIF(TRIM(CONCAT_WS(' ', vf.first_name, vf.last_name)), '')
             )                                        AS linked_name,
             COALESCE(st.roll_no, st.register_no, vf.staff_code) AS linked_identifier,
             COALESCE(sd.name, vfd.name)              AS linked_department,
             v.id                                     AS visit_id
      FROM medical_bills b
      LEFT JOIN medical_staff ms        ON ms.id = b.attended_by_staff_id
      LEFT JOIN medical_visits v        ON v.id = b.visit_id
      LEFT JOIN students st             ON st.id = v.student_id
      LEFT JOIN soa_applications sa     ON sa.id = st.soa_application_id
      LEFT JOIN classes cl              ON cl.id = st.class_id
      LEFT JOIN departments sd          ON sd.id = cl.department_id
      LEFT JOIN faculty vf              ON vf.id = v.faculty_id
      LEFT JOIN departments vfd         ON vfd.id = vf.department_id
      WHERE b.id = ${id}
    `);

    const bill = bills[0];
    if (!bill) {
      throw new NotFoundException({
        message: 'Bill not found',
        errorCode: 'BILL_NOT_FOUND',
      });
    }

    const items = await this.prisma.$queryRaw<
      {
        id: number;
        item_type: string;
        description: string;
        quantity: number;
        rate: string;
        amount: string;
      }[]
    >(Prisma.sql`
      SELECT id, item_type, description, quantity, rate::text AS rate, amount::text AS amount
      FROM medical_bill_items
      WHERE bill_id = ${id}
      ORDER BY id ASC
    `);

    const money = (v: string | null) => (v == null ? 0 : Number(v));

    return {
      receipt_no: `MB-${String(bill.id).padStart(4, '0')}`,
      bill_id: bill.id,
      issued_at: bill.created_at.toISOString(),
      patient: {
        // The linked record wins when the bill came from a queued visit; the
        // typed values are the fallback for a walk-in.
        name: bill.linked_name ?? bill.patient_name,
        department: bill.linked_department ?? bill.patient_dept,
        // Roll number for a student, staff code for a faculty patient. Null
        // when the bill has no visit behind it, and the receipt then omits the
        // line rather than printing a guess.
        identifier: bill.linked_identifier,
        is_linked: bill.visit_id != null,
      },
      // The clinical reason the visit was billed for; drives the receipt's
      // "Reason for consultation" block.
      reason: bill.condition,
      attended_by: bill.staff_name
        ? { name: bill.staff_name, designation: bill.staff_designation }
        : null,
      payment_mode: MODE_LABEL[bill.payment_mode] ?? bill.payment_mode,
      // Only ever populated for a UPI settlement, so the receipt prints the
      // reference line only when there is one.
      upi_transaction_id: bill.upi_transaction_id,
      status: STATUS_LABEL[bill.status] ?? bill.status,
      items: items.map((it) => ({
        id: it.id,
        item_type: it.item_type,
        description: it.description,
        quantity: it.quantity,
        rate: money(it.rate),
        amount: money(it.amount),
      })),
      totals: {
        medicine: money(bill.medicine_total),
        service: money(bill.service_total),
        total: money(bill.total),
      },
    };
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
