import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from 'generated/prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { FinanceAuditService } from '../finance-audit.service';
import { UpsertFinanceFundDto } from './dto/upsert-fund.dto';

/** Shape returned to the client. Decimal/BigInt are never sent raw. */
export interface FinanceFundView {
  id: number;
  academic_year: string;
  total_amount: number;
  available_amount: number;
  committed_amount: number;
  utilisation_pct: number;
  is_locked: boolean;
  notes: string | null;
  updated_at: string;
}

export interface FinanceLedgerView {
  id: string;
  entry_type: string;
  source: string;
  amount: number;
  balance_after: number;
  narration: string;
  purchase_order_proposal_id: number | null;
  service_order_proposal_id: number | null;
  created_at: string;
  created_by: string | null;
}

@Injectable()
export class FinanceFundService {
  private readonly logger = new Logger(FinanceFundService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: FinanceAuditService,
  ) {}

  /**
   * Decimal -> number for transport. Safe here because the column is
   * NUMERIC(14,2): at most 12 integer digits, well inside a JS double's exact
   * integer range, and the value is only ever displayed, never re-used as the
   * basis for a stored calculation (all arithmetic happens in the database).
   */
  private toAmount(value: Prisma.Decimal | null | undefined): number {
    return value ? Number(value) : 0;
  }

  private viewFund(row: {
    id: number;
    academic_year: string;
    total_amount: Prisma.Decimal;
    available_amount: Prisma.Decimal;
    is_locked: boolean;
    notes: string | null;
    updated_at: Date;
  }): FinanceFundView {
    const total = this.toAmount(row.total_amount);
    const available = this.toAmount(row.available_amount);
    const committed = Math.max(0, total - available);
    return {
      id: row.id,
      academic_year: row.academic_year,
      total_amount: total,
      available_amount: available,
      committed_amount: committed,
      utilisation_pct: total > 0 ? Math.round((committed / total) * 1000) / 10 : 0,
      is_locked: row.is_locked,
      notes: row.notes,
      updated_at: row.updated_at.toISOString(),
    };
  }

  /** GET /finance/fund — every year's fund, newest first. */
  async findAll(): Promise<FinanceFundView[]> {
    const rows = await this.prisma.finance_funds.findMany({
      orderBy: { academic_year: 'desc' },
    });
    return rows.map((r) => this.viewFund(r));
  }

  /**
   * GET /finance/fund/current — the fund the UI works against by default.
   * Returns null (not 404) when Finance has not created one yet, so the
   * dashboard can render an empty state instead of an error.
   */
  async findCurrent(): Promise<FinanceFundView | null> {
    const row = await this.prisma.finance_funds.findFirst({
      where: { is_locked: false },
      orderBy: { academic_year: 'desc' },
    });
    return row ? this.viewFund(row) : null;
  }

  async findByIdOrThrow(id: number): Promise<FinanceFundView> {
    const row = await this.prisma.finance_funds.findUnique({ where: { id } });
    if (!row) {
      throw new NotFoundException({
        message: 'That finance fund does not exist',
        errorCode: 'FINANCE_FUND_NOT_FOUND',
      });
    }
    return this.viewFund(row);
  }

  /**
   * POST /finance/fund — create the fund for a year and credit its opening
   * total in the same transaction, so the fund and its first ledger entry can
   * never exist without each other.
   */
  async create(dto: UpsertFinanceFundDto, actorUserId: number, ctx: RequestContext) {
    const existing = await this.prisma.finance_funds.findUnique({
      where: { academic_year: dto.academic_year },
    });
    if (existing) {
      throw new ConflictException({
        message: `A finance fund for ${dto.academic_year} already exists`,
        errorCode: 'FINANCE_FUND_EXISTS',
      });
    }

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const fund = await tx.finance_funds.create({
          data: {
            academic_year: dto.academic_year,
            total_amount: new Prisma.Decimal(dto.total_amount),
            notes: dto.notes ?? null,
            created_by_user_id: actorUserId,
          },
        });

        // available_amount is trigger-owned; it only moves via the ledger.
        if (dto.total_amount > 0) {
          await tx.finance_ledger_entries.create({
            data: {
              fund_id: fund.id,
              entry_type: 'credit',
              source: 'opening_balance',
              amount: new Prisma.Decimal(dto.total_amount),
              // Stamped by the DB trigger; a placeholder is required by the
              // NOT NULL column and is overwritten before the row lands.
              balance_after: new Prisma.Decimal(0),
              narration: dto.notes?.slice(0, 500) || `Opening balance for ${dto.academic_year}`,
              created_by_user_id: actorUserId,
            },
          });
        }

        await this.audit.record({
          actorUserId,
          action: 'fund.created',
          entityType: 'finance_fund',
          entityId: fund.id,
          after: { academic_year: dto.academic_year, total_amount: dto.total_amount },
          ipAddress: ctx.ip,
          userAgent: ctx.userAgent,
          tx,
        });

        return tx.finance_funds.findUniqueOrThrow({ where: { id: fund.id } });
      });

      return this.viewFund(created);
    } catch (err) {
      throw this.translate(err, 'creating the finance fund');
    }
  }

  /**
   * PUT /finance/fund/:id — revise the declared total (and/or notes/lock).
   *
   * A revision never writes the balance directly. It posts the *difference*
   * as a ledger adjustment, which is what moves `available_amount`. Lowering
   * the total below what is already committed is therefore rejected by the
   * database's own no-overdraft rule, not by a check here that could drift.
   */
  async update(
    id: number,
    dto: UpsertFinanceFundDto,
    actorUserId: number,
    ctx: RequestContext,
  ) {
    const current = await this.prisma.finance_funds.findUnique({ where: { id } });
    if (!current) {
      throw new NotFoundException({
        message: 'That finance fund does not exist',
        errorCode: 'FINANCE_FUND_NOT_FOUND',
      });
    }

    const currentTotal = this.toAmount(current.total_amount);
    const delta = dto.total_amount - currentTotal;

    if (delta !== 0 && !dto.reason) {
      throw new BadRequestException({
        message: 'A reason is required when the total amount is changed',
        errorCode: 'FINANCE_REASON_REQUIRED',
      });
    }

    // A locked year is frozen. Allow only the unlock itself.
    if (current.is_locked && dto.is_locked !== false) {
      throw new ConflictException({
        message: `The fund for ${current.academic_year} is locked. Unlock it before making changes.`,
        errorCode: 'FINANCE_FUND_LOCKED',
      });
    }

    try {
      const updated = await this.prisma.$transaction(async (tx) => {
        if (delta !== 0) {
          await tx.finance_ledger_entries.create({
            data: {
              fund_id: id,
              entry_type: delta > 0 ? 'adjustment_increase' : 'adjustment_decrease',
              source: 'manual_adjustment',
              amount: new Prisma.Decimal(Math.abs(delta)),
              balance_after: new Prisma.Decimal(0), // trigger overwrites
              narration: `Total revised from ${currentTotal} to ${dto.total_amount}: ${dto.reason}`.slice(
                0,
                500,
              ),
              created_by_user_id: actorUserId,
            },
          });
        }

        const row = await tx.finance_funds.update({
          where: { id },
          data: {
            total_amount: new Prisma.Decimal(dto.total_amount),
            notes: dto.notes ?? current.notes,
            is_locked: dto.is_locked ?? current.is_locked,
            updated_by_user_id: actorUserId,
          },
        });

        await this.audit.record({
          actorUserId,
          action: 'fund.updated',
          entityType: 'finance_fund',
          entityId: id,
          before: { total_amount: currentTotal, is_locked: current.is_locked },
          after: {
            total_amount: dto.total_amount,
            is_locked: row.is_locked,
            reason: dto.reason ?? null,
          },
          ipAddress: ctx.ip,
          userAgent: ctx.userAgent,
          tx,
        });

        return row;
      });

      return this.viewFund(updated);
    } catch (err) {
      throw this.translate(err, 'updating the finance fund');
    }
  }

  /** GET /finance/fund/:id/ledger — the append-only movement history. */
  async ledger(fundId: number, limit = 100, offset = 0): Promise<FinanceLedgerView[]> {
    await this.findByIdOrThrow(fundId);
    const rows = await this.prisma.finance_ledger_entries.findMany({
      where: { fund_id: fundId },
      orderBy: { created_at: 'desc' },
      take: Math.min(Math.max(limit, 1), 500),
      skip: Math.max(offset, 0),
      include: { users: { select: { email: true } } },
    });

    return rows.map((r) => ({
      // BigInt cannot be JSON-serialised, so it is sent as a string.
      id: r.id.toString(),
      entry_type: r.entry_type,
      source: r.source,
      amount: this.toAmount(r.amount),
      balance_after: this.toAmount(r.balance_after),
      narration: r.narration,
      purchase_order_proposal_id: r.purchase_order_proposal_id,
      service_order_proposal_id: r.service_order_proposal_id,
      created_at: r.created_at.toISOString(),
      created_by: r.users?.email ?? null,
    }));
  }

  /**
   * Turns the database's own integrity failures into the right HTTP status,
   * so a genuine business rule (overdraft, double-spend, locked year) is a
   * 4xx the UI can explain — not an opaque 500.
   */
  private translate(err: unknown, whileDoing: string): Error {
    const message = err instanceof Error ? err.message : String(err);

    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return new ConflictException({
        message: 'This amount has already been committed for that order.',
        errorCode: 'FINANCE_DUPLICATE_MOVEMENT',
      });
    }
    if (message.includes('insufficient funds')) {
      return new ConflictException({
        message:
          'The fund does not hold enough money for this. Increase the total amount or release an existing commitment first.',
        errorCode: 'FINANCE_INSUFFICIENT_FUNDS',
      });
    }
    if (message.includes('is locked')) {
      return new ConflictException({
        message: 'That financial year is locked and cannot accept further movement.',
        errorCode: 'FINANCE_FUND_LOCKED',
      });
    }
    if (message.includes('available_amount is derived')) {
      return new ConflictException({
        message: 'The balance can only change through a ledger entry.',
        errorCode: 'FINANCE_BALANCE_READONLY',
      });
    }

    this.logger.error(`DB error while ${whileDoing}`, err);
    return new InternalServerErrorException({
      message: 'Something went wrong. Please try again.',
      errorCode: 'INTERNAL_ERROR',
    });
  }
}

/** Request metadata recorded on every mutating finance action. */
export interface RequestContext {
  ip: string | null;
  userAgent: string | null;
}
