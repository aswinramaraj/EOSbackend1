import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../../../generated/prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { ListExamFeeTransactionsQueryDto } from './dto/list-exam-fee-transactions-query.dto';
import { CreateExamFeeTransactionDto } from './dto/create-exam-fee-transaction.dto';
import { UpdateExamFeeStatusDto } from './dto/update-exam-fee-status.dto';

const STUDENT_SELECT = {
  id: true,
  user_id: true,
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

const FEE_HEAD_LABEL: Record<string, string> = {
  exam_fee: 'Exam fee',
  arrear_fee: 'Arrear fee',
  revaluation_fee: 'Revaluation fee',
  certificate_fee: 'Certificate fee',
  late_fee: 'Late fee',
};

@Injectable()
export class ExamFeeTransactionsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: ListExamFeeTransactionsQueryDto) {
    const where: Prisma.exam_fee_transactionsWhereInput = {};
    if (query.fee_head) where.fee_head = query.fee_head;
    if (query.mode) where.mode = query.mode;
    if (query.status) where.status = query.status;
    if (query.search) {
      where.OR = [
        { receipt_no: { contains: query.search, mode: 'insensitive' } },
        {
          students: {
            OR: [
              {
                student_id_no: { contains: query.search, mode: 'insensitive' },
              },
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

  /** Real KPI tiles — "outstanding" and its student count are computed from the same pending/unpaid rows, not a separately-tracked demand ledger. */
  async getStats() {
    const rows = await this.prisma.exam_fee_transactions.findMany({
      select: {
        amount: true,
        status: true,
        fee_head: true,
        student_id: true,
        reconciled_at: true,
      },
    });

    const raised = rows.reduce((sum, r) => sum + Number(r.amount), 0);
    const collected = rows
      .filter((r) => r.status === 'paid')
      .reduce((sum, r) => sum + Number(r.amount), 0);

    const outstandingRows = rows.filter(
      (r) => r.status === 'pending' || r.status === 'unpaid',
    );
    const outstandingAmount = outstandingRows.reduce(
      (sum, r) => sum + Number(r.amount),
      0,
    );
    const outstandingStudents = new Set(
      outstandingRows.map((r) => r.student_id),
    ).size;

    const revaluationRows = rows.filter(
      (r) => r.fee_head === 'revaluation_fee',
    );
    const revaluationAmount = revaluationRows
      .filter((r) => r.status === 'paid')
      .reduce((sum, r) => sum + Number(r.amount), 0);

    const refundedRows = rows.filter((r) => r.status === 'refunded');
    const refundedAmount = refundedRows.reduce(
      (sum, r) => sum + Number(r.amount),
      0,
    );

    const toReconcileCount = rows.filter(
      (r) => r.status === 'paid' && r.reconciled_at == null,
    ).length;

    return {
      collected,
      collected_pct_of_demand:
        raised > 0 ? Math.round((collected / raised) * 1000) / 10 : null,
      outstanding: outstandingAmount,
      outstanding_students: outstandingStudents,
      revaluation_fees: revaluationAmount,
      revaluation_applications: revaluationRows.length,
      refunds_processed: refundedAmount,
      refunds_cases: refundedRows.length,
      to_reconcile_count: toReconcileCount,
    };
  }

  /** Online payments settle from the gateway feed the instant they land — everything else (counter cash, challan) needs a human to actually reconcile it against the bank statement. */
  async create(dto: CreateExamFeeTransactionDto) {
    const student = await this.prisma.students.findUnique({
      where: { id: dto.student_id },
    });
    if (!student)
      throw new NotFoundException({
        message: 'Student not found.',
        errorCode: 'STUDENT_NOT_FOUND',
      });

    const receiptNo = await this.generateReceiptNo();
    const mode = dto.mode ?? 'online';

    const created = await this.prisma.exam_fee_transactions.create({
      data: {
        student_id: dto.student_id,
        fee_head: dto.fee_head,
        amount: dto.amount,
        mode,
        receipt_no: receiptNo,
        reference_no: dto.reference_no,
        reconciled_at: mode === 'online' ? new Date() : undefined,
      },
      include: INCLUDE,
    });

    await this.prisma.notifications.create({
      data: {
        user_id: created.students.user_id,
        title: 'Fee payment recorded',
        message: `Your ${FEE_HEAD_LABEL[created.fee_head] ?? created.fee_head} payment of ₹${Number(created.amount)} has been recorded. Receipt: ${receiptNo}.`,
        related_entity_type: 'exam_fee_transactions',
        related_entity_id: created.id,
      },
    });

    return { ...created, amount: Number(created.amount) };
  }

  async updateStatus(id: number, dto: UpdateExamFeeStatusDto) {
    const existing = await this.prisma.exam_fee_transactions.findUnique({
      where: { id },
    });
    if (!existing)
      throw new NotFoundException({
        message: 'Fee transaction not found.',
        errorCode: 'FEE_TRANSACTION_NOT_FOUND',
      });

    const updated = await this.prisma.exam_fee_transactions.update({
      where: { id },
      data: { status: dto.status },
      include: INCLUDE,
    });
    return { ...updated, amount: Number(updated.amount) };
  }

  /** POST /exam-fee-transactions/:id/reconcile — the manual counterpart to online's automatic gateway reconciliation. */
  async reconcile(id: number) {
    const existing = await this.prisma.exam_fee_transactions.findUnique({
      where: { id },
    });
    if (!existing)
      throw new NotFoundException({
        message: 'Fee transaction not found.',
        errorCode: 'FEE_TRANSACTION_NOT_FOUND',
      });
    if (existing.status !== 'paid') {
      throw new BadRequestException({
        message: 'Only paid transactions can be reconciled.',
        errorCode: 'NOT_PAID',
      });
    }
    if (existing.reconciled_at) {
      throw new BadRequestException({
        message: 'This transaction is already reconciled.',
        errorCode: 'ALREADY_RECONCILED',
      });
    }

    const updated = await this.prisma.exam_fee_transactions.update({
      where: { id },
      data: { reconciled_at: new Date() },
      include: INCLUDE,
    });
    return { ...updated, amount: Number(updated.amount) };
  }

  /** POST /exam-fee-transactions/:id/remind — real notification about the pending/unpaid dues, same dispatch pattern used across this session's other remind() actions. */
  async remind(id: number) {
    const existing = await this.prisma.exam_fee_transactions.findUnique({
      where: { id },
      include: INCLUDE,
    });
    if (!existing)
      throw new NotFoundException({
        message: 'Fee transaction not found.',
        errorCode: 'FEE_TRANSACTION_NOT_FOUND',
      });
    if (existing.status !== 'pending' && existing.status !== 'unpaid') {
      throw new BadRequestException({
        message: 'This transaction is not pending or unpaid.',
        errorCode: 'NOT_OUTSTANDING',
      });
    }

    return this.prisma.notifications.create({
      data: {
        user_id: existing.students.user_id,
        title: `${FEE_HEAD_LABEL[existing.fee_head] ?? existing.fee_head} payment due`,
        message: `Your ${FEE_HEAD_LABEL[existing.fee_head] ?? existing.fee_head} of ₹${Number(existing.amount)} is still ${existing.status}. Please pay at the earliest.`,
        related_entity_type: 'exam_fee_transactions',
        related_entity_id: existing.id,
      },
    });
  }

  private async generateReceiptNo(): Promise<string> {
    const year = new Date().getFullYear();
    for (let attempt = 0; attempt < 5; attempt++) {
      const candidate = `RCP-${year}-${Math.floor(100000 + Math.random() * 900000)}`;
      const clash = await this.prisma.exam_fee_transactions.findUnique({
        where: { receipt_no: candidate },
      });
      if (!clash) return candidate;
    }
    return `RCP-${year}-${Date.now()}`;
  }
}
