import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../../../../generated/prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { ListExamFeeTransactionsQueryDto } from './dto/list-exam-fee-transactions-query.dto';
import { CreateExamFeeTransactionDto } from './dto/create-exam-fee-transaction.dto';
import { UpdateExamFeeStatusDto } from './dto/update-exam-fee-status.dto';

const STUDENT_SELECT = {
  id: true,
  student_id_no: true,
  roll_no: true,
  register_no: true,
  soa_applications: { select: { first_name: true, last_name: true } },
  classes: {
    select: {
      current_semester: true,
      departments: { select: { id: true, code: true, name: true } },
    },
  },
} as const;

const INCLUDE = {
  students: { select: STUDENT_SELECT },
} as const;

@Injectable()
export class ExamFeeTransactionsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: ListExamFeeTransactionsQueryDto) {
    const where: Prisma.exam_fee_transactionsWhereInput = {};
    if (query.fee_head) where.fee_head = query.fee_head;
    if (query.status) where.status = query.status;
    if (query.search) {
      where.OR = [
        { receipt_no: { contains: query.search, mode: 'insensitive' } },
        {
          students: {
            OR: [
              { student_id_no: { contains: query.search, mode: 'insensitive' } },
              { register_no: { contains: query.search, mode: 'insensitive' } },
            ],
          },
        },
      ];
    }

    const rows = await this.prisma.exam_fee_transactions.findMany({
      where,
      include: INCLUDE,
      orderBy: { created_at: 'desc' },
    });
    return rows.map((r) => ({ ...r, amount: Number(r.amount) }));
  }

  async getStats() {
    const rows = await this.prisma.exam_fee_transactions.findMany({ select: { amount: true, status: true } });
    const raised = rows.reduce((sum, r) => sum + Number(r.amount), 0);
    const collected = rows.filter((r) => r.status === 'paid').reduce((sum, r) => sum + Number(r.amount), 0);
    const pending = rows.filter((r) => r.status === 'pending' || r.status === 'unpaid').length;
    const refunded = rows.filter((r) => r.status === 'refunded').length;

    return { raised, collected, collected_pct: raised > 0 ? Math.round((collected / raised) * 100) : 0, pending_count: pending, refunded_count: refunded };
  }

  async create(dto: CreateExamFeeTransactionDto) {
    const student = await this.prisma.students.findUnique({ where: { id: dto.student_id } });
    if (!student) throw new NotFoundException({ message: 'Student not found.', errorCode: 'STUDENT_NOT_FOUND' });

    const receiptNo = await this.generateReceiptNo();

    const created = await this.prisma.exam_fee_transactions.create({
      data: {
        student_id: dto.student_id,
        fee_head: dto.fee_head,
        amount: dto.amount,
        mode: dto.mode ?? 'online',
        receipt_no: receiptNo,
      },
      include: INCLUDE,
    });
    return { ...created, amount: Number(created.amount) };
  }

  async updateStatus(id: number, dto: UpdateExamFeeStatusDto) {
    const existing = await this.prisma.exam_fee_transactions.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException({ message: 'Fee transaction not found.', errorCode: 'FEE_TRANSACTION_NOT_FOUND' });

    const updated = await this.prisma.exam_fee_transactions.update({
      where: { id },
      data: { status: dto.status },
      include: INCLUDE,
    });
    return { ...updated, amount: Number(updated.amount) };
  }

  private async generateReceiptNo(): Promise<string> {
    const year = new Date().getFullYear();
    for (let attempt = 0; attempt < 5; attempt++) {
      const candidate = `RCP-${year}-${Math.floor(100000 + Math.random() * 900000)}`;
      const clash = await this.prisma.exam_fee_transactions.findUnique({ where: { receipt_no: candidate } });
      if (!clash) return candidate;
    }
    return `RCP-${year}-${Date.now()}`;
  }
}
