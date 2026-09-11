import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma } from 'generated/prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { FinanceAuditService } from '../finance-audit.service';
import { DecideProposalDto } from './dto/decide-proposal.dto';
import { withDbRetry, isTransientDbError, dbUnavailable } from '../db-retry';
import type { RequestContext } from '../fund/fund.service';

export type ProposalKind = 'pop' | 'sop';

/** One nominated faculty member, read from finance_proposal_assignments. */
interface AssignmentRow {
  faculty_id: number;
  note: string | null;
  name: string;
  department: string | null;
}

export interface ProposalView {
  id: number;
  kind: ProposalKind;
  status: string;
  reference: string | null;
  title: string;
  description: string | null;
  quantity: string | null;
  estimated_amount: number | null;
  needed_by: string | null;
  department: string | null;
  requested_by: string | null;
  vendor: string | null;
  vendor_id: number | null;
  hod_remarks: string | null;
  finance_remarks: string | null;
  hod_reviewed_at: string | null;
  finance_reviewed_at: string | null;
  created_at: string;
  /** Set once Finance has debited the fund for this proposal. */
  approved_amount: number | null;
  order_number: string | null;
  /** Faculty nominated at approval time, before the order is delivered. */
  assigned_faculty_id: number | null;
  assigned_faculty_name: string | null;
  assigned_faculty_department: string | null;
  assignment_note: string | null;
}

@Injectable()
export class FinanceApprovalsService {
  private readonly logger = new Logger(FinanceApprovalsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: FinanceAuditService,
  ) {}

  private amount(v: Prisma.Decimal | null | undefined): number | null {
    return v === null || v === undefined ? null : Number(v);
  }

  /**
   * Who each proposal is nominated for.
   *
   * Two typed queries rather than a nested include: the assignments model is
   * declared with scalar foreign keys and no Prisma `@relation`, precisely so
   * that adding it did not require editing purchase_order_proposals,
   * service_order_proposals, faculty or users. The faculty names are therefore
   * fetched in a second query and joined in memory — one extra round trip, and
   * not one existing model touched.
   */
  private async assignmentMap(
    kind: ProposalKind,
    ids: number[],
  ): Promise<Map<number, AssignmentRow>> {
    const map = new Map<number, AssignmentRow>();
    if (ids.length === 0) return map;

    const rows = await this.prisma.finance_proposal_assignments.findMany({
      where:
        kind === 'pop'
          ? { purchase_order_proposal_id: { in: ids } }
          : { service_order_proposal_id: { in: ids } },
      select: {
        purchase_order_proposal_id: true,
        service_order_proposal_id: true,
        faculty_id: true,
        note: true,
      },
    });

    if (rows.length === 0) return map;

    const faculty = await this.prisma.faculty.findMany({
      where: { id: { in: [...new Set(rows.map((r) => r.faculty_id))] } },
      select: {
        id: true,
        first_name: true,
        last_name: true,
        departments: { select: { name: true } },
      },
    });
    const byFacultyId = new Map(faculty.map((f) => [f.id, f]));

    for (const r of rows) {
      const proposalId =
        kind === 'pop' ? r.purchase_order_proposal_id : r.service_order_proposal_id;
      if (proposalId === null) continue;
      const f = byFacultyId.get(r.faculty_id);
      map.set(proposalId, {
        faculty_id: r.faculty_id,
        note: r.note,
        name: f ? `${f.first_name} ${f.last_name}`.trim() : `Faculty #${r.faculty_id}`,
        department: f?.departments?.name ?? null,
      });
    }

    return map;
  }

  /**
   * Next PO/SO number, in the same `PO-YYYY-NNNN` shape the existing rows use.
   *
   * Derived from the highest existing number for the current year rather than
   * from a count, so deleting or back-dating a row can never hand out a number
   * that is already taken. Runs inside the approval transaction; the unique
   * constraint on the column is the final backstop.
   */
  private async nextOrderNumber(
    tx: Prisma.TransactionClient,
    kind: ProposalKind,
  ): Promise<string> {
    const prefix = kind === 'pop' ? 'PO' : 'SO';
    const year = new Date().getFullYear();
    const stem = `${prefix}-${year}-`;

    const latest =
      kind === 'pop'
        ? await tx.purchase_orders.findFirst({
            where: { po_number: { startsWith: stem } },
            orderBy: { po_number: 'desc' },
            select: { po_number: true },
          })
        : await tx.service_orders.findFirst({
            where: { so_number: { startsWith: stem } },
            orderBy: { so_number: 'desc' },
            select: { so_number: true },
          });

    const current = latest
      ? ('po_number' in latest ? latest.po_number : latest.so_number)
      : null;
    const lastSeq = current ? Number.parseInt(current.slice(stem.length), 10) : 0;
    const next = (Number.isFinite(lastSeq) ? lastSeq : 0) + 1;

    return `${stem}${String(next).padStart(4, '0')}`;
  }

  /** Flattens the (at most one) nominated faculty member for the list view. */
  private assignmentView(assignment: AssignmentRow | null | undefined) {
    if (!assignment) {
      return {
        assigned_faculty_id: null,
        assigned_faculty_name: null,
        assigned_faculty_department: null,
        assignment_note: null,
      };
    }
    return {
      assigned_faculty_id: assignment.faculty_id,
      assigned_faculty_name: assignment.name,
      assigned_faculty_department: assignment.department,
      assignment_note: assignment.note,
    };
  }

  /**
   * GET /finance/proposals?kind=pop|sop&status=
   *
   * Finance's queue. `pending` is the actionable set: HoD has forwarded it and
   * Finance has not yet decided. Everything else is shown for context/history.
   */
  async list(kind: ProposalKind, status?: string): Promise<ProposalView[]> {
    const where = status ? { status: status as never } : {};

    if (kind === 'pop') {
      const rows = await this.prisma.purchase_order_proposals.findMany({
        where,
        orderBy: { id: 'desc' },
        include: {
          purchase_indents: {
            include: { departments: { select: { name: true } }, users: { select: { email: true } } },
          },
          vendors: { select: { id: true, name: true } },
          purchase_orders: { select: { po_number: true } },
        },
      });

      const debits = await this.debitMap('pop', rows.map((r) => r.id));
      const assignments = await this.assignmentMap('pop', rows.map((r) => r.id));

      return rows.map((r) => ({
        id: r.id,
        kind: 'pop' as const,
        status: r.status,
        reference: r.purchase_indents.ref,
        title: r.purchase_indents.item_name,
        description: r.purchase_indents.purpose,
        quantity: String(r.purchase_indents.quantity),
        estimated_amount: this.amount(r.purchase_indents.estimated_amount),
        needed_by: r.purchase_indents.needed_by?.toISOString() ?? null,
        department: r.purchase_indents.departments?.name ?? null,
        requested_by: r.purchase_indents.users?.email ?? null,
        vendor: r.vendors?.name ?? null,
        vendor_id: r.vendors?.id ?? null,
        hod_remarks: r.hod_remarks,
        finance_remarks: r.finance_remarks,
        hod_reviewed_at: r.hod_reviewed_at?.toISOString() ?? null,
        finance_reviewed_at: r.finance_reviewed_at?.toISOString() ?? null,
        created_at: r.purchase_indents.created_at.toISOString(),
        approved_amount: debits.get(r.id) ?? null,
        order_number: r.purchase_orders?.po_number ?? null,
        ...this.assignmentView(assignments.get(r.id)),
      }));
    }

    const rows = await this.prisma.service_order_proposals.findMany({
      where,
      orderBy: { id: 'desc' },
      include: {
        service_indents: {
          include: { departments: { select: { name: true } }, users: { select: { email: true } } },
        },
        vendors: { select: { id: true, name: true } },
        service_orders: { select: { so_number: true } },
      },
    });

    const debits = await this.debitMap('sop', rows.map((r) => r.id));
    const assignments = await this.assignmentMap('sop', rows.map((r) => r.id));

    return rows.map((r) => ({
      id: r.id,
      kind: 'sop' as const,
      status: r.status,
      reference: r.service_indents.ref,
      title: r.service_indents.title ?? r.service_indents.service_description.slice(0, 120),
      description: r.service_indents.service_description,
      quantity: r.service_indents.quantity,
      estimated_amount: null, // service_indents carries no estimate column
      needed_by: r.service_indents.needed_by?.toISOString() ?? null,
      department: r.service_indents.departments?.name ?? null,
      requested_by: r.service_indents.users?.email ?? null,
      vendor: r.vendors?.name ?? null,
      vendor_id: r.vendors?.id ?? null,
      hod_remarks: r.hod_remarks,
      finance_remarks: r.finance_remarks,
      hod_reviewed_at: r.hod_reviewed_at?.toISOString() ?? null,
      finance_reviewed_at: r.finance_reviewed_at?.toISOString() ?? null,
      created_at: r.service_indents.created_at.toISOString(),
      approved_amount: debits.get(r.id) ?? null,
      order_number: r.service_orders?.so_number ?? null,
      ...this.assignmentView(assignments.get(r.id)),
    }));
  }

  /**
   * What Finance currently has committed per proposal.
   *
   * Net of reversals: the ledger is append-only, so releasing a commitment
   * adds a compensating `order_cancellation` entry rather than deleting the
   * debit. Reporting the raw debit would leave a released proposal still
   * showing an approved amount after it went back to the queue — so a
   * proposal whose debit has been fully reversed reports nothing.
   */
  private async debitMap(kind: ProposalKind, ids: number[]): Promise<Map<number, number>> {
    if (ids.length === 0) return new Map();
    const idField = kind === 'pop' ? 'purchase_order_proposal_id' : 'service_order_proposal_id';
    const rows = await this.prisma.finance_ledger_entries.findMany({
      where: {
        [idField]: { in: ids },
        source: { in: [kind === 'pop' ? 'pop_approval' : 'sop_approval', 'order_cancellation'] },
      },
      select: {
        amount: true,
        entry_type: true,
        purchase_order_proposal_id: true,
        service_order_proposal_id: true,
      },
    });

    const map = new Map<number, number>();
    for (const r of rows) {
      const key = kind === 'pop' ? r.purchase_order_proposal_id : r.service_order_proposal_id;
      if (key === null) continue;
      const signed = r.entry_type === 'debit' ? Number(r.amount) : -Number(r.amount);
      map.set(key, (map.get(key) ?? 0) + signed);
    }
    // Drop anything fully released so the UI shows no amount at all.
    for (const [key, net] of map) {
      if (net <= 0) map.delete(key);
    }
    return map;
  }

  /**
   * POST /finance/proposals/:kind/:id/decision
   *
   * Approving does three things atomically: stamp the proposal as
   * finance_approved, debit the fund through the ledger, and record the audit
   * entry. If the fund cannot cover it, the database rejects the debit and the
   * whole thing rolls back — the proposal is never left approved with no money
   * behind it.
   */
  async decide(
    kind: ProposalKind,
    id: number,
    dto: DecideProposalDto,
    actorUserId: number,
    ctx: RequestContext,
  ) {
    const proposal =
      kind === 'pop'
        ? await this.prisma.purchase_order_proposals.findUnique({ where: { id } })
        : await this.prisma.service_order_proposals.findUnique({ where: { id } });

    if (!proposal) {
      throw new NotFoundException({
        message: 'That proposal does not exist',
        errorCode: 'FINANCE_PROPOSAL_NOT_FOUND',
      });
    }

    // Finance acts once. Re-deciding a proposal that has already moved past
    // Finance would either double-spend or silently contradict the record.
    if (proposal.status !== 'pending') {
      throw new ConflictException({
        message: `This proposal has already been ${proposal.status.replace(/_/g, ' ')} and cannot be decided again`,
        errorCode: 'FINANCE_PROPOSAL_ALREADY_DECIDED',
      });
    }

    if (dto.decision === 'reject') {
      const updated = await this.rejectProposal(kind, id, dto, actorUserId, ctx);
      return updated;
    }

    if (!dto.amount) {
      throw new BadRequestException({
        message: 'An approved amount is required',
        errorCode: 'VALIDATION_ERROR',
      });
    }

    const fund = dto.fund_id
      ? await this.prisma.finance_funds.findUnique({ where: { id: dto.fund_id } })
      : await this.prisma.finance_funds.findFirst({
          where: { is_locked: false },
          orderBy: { academic_year: 'desc' },
        });

    if (!fund) {
      throw new ConflictException({
        message:
          'No open finance fund exists. Set the total amount in Finance Overview before approving.',
        errorCode: 'FINANCE_FUND_MISSING',
      });
    }

    // The quantity the order is placed for comes from the real indent behind
    // the proposal (service indents record quantity as free text, so only a
    // clean integer is used; anything else leaves it unset).
    let quantityOrdered: number | null = null;
    if (kind === 'pop') {
      const indent = await this.prisma.purchase_order_proposals.findUnique({
        where: { id },
        select: { purchase_indents: { select: { quantity: true } } },
      });
      quantityOrdered = indent?.purchase_indents?.quantity ?? null;
    } else {
      const indent = await this.prisma.service_order_proposals.findUnique({
        where: { id },
        select: { service_indents: { select: { quantity: true } } },
      });
      const raw = indent?.service_indents?.quantity ?? null;
      const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
      quantityOrdered = Number.isFinite(parsed) && parsed > 0 ? parsed : null;
    }

    try {
      // Safe to retry: the transaction's first statement claims the proposal
      // with `WHERE status = 'pending'`, so a replay after a committed attempt
      // matches zero rows and conflicts instead of debiting twice.
      return await withDbRetry(
        () => this.prisma.$transaction(async (tx) => {
        // Concurrency guard: flip the status only if it is still `pending`.
        // This is the thing that makes double-approval impossible — the row
        // lock serialises two simultaneous approvals, and the loser matches
        // zero rows instead of debiting the fund a second time. It replaces
        // the old "one debit per proposal" unique index, which also blocked
        // the legitimate case of re-approving a proposal whose earlier
        // commitment had been released.
        const stampData = {
          status: 'finance_approved' as const,
          finance_reviewed_by: actorUserId,
          finance_reviewed_at: new Date(),
          finance_remarks: dto.remarks ?? null,
        };

        const claimed =
          kind === 'pop'
            ? await tx.purchase_order_proposals.updateMany({
                where: { id, status: 'pending' },
                data: stampData,
              })
            : await tx.service_order_proposals.updateMany({
                where: { id, status: 'pending' },
                data: stampData,
              });

        if (claimed.count === 0) {
          throw new ConflictException({
            message: 'This proposal was decided by someone else a moment ago. Reload and try again.',
            errorCode: 'FINANCE_PROPOSAL_ALREADY_DECIDED',
          });
        }

        const stamped =
          kind === 'pop'
            ? await tx.purchase_order_proposals.findUniqueOrThrow({ where: { id } })
            : await tx.service_order_proposals.findUniqueOrThrow({ where: { id } });

        await tx.finance_ledger_entries.create({
          data: {
            fund_id: fund.id,
            entry_type: 'debit',
            source: kind === 'pop' ? 'pop_approval' : 'sop_approval',
            amount: new Prisma.Decimal(dto.amount!),
            balance_after: new Prisma.Decimal(0), // trigger overwrites
            purchase_order_proposal_id: kind === 'pop' ? id : null,
            service_order_proposal_id: kind === 'sop' ? id : null,
            narration: `${kind.toUpperCase()} #${id} approved by Finance`,
            created_by_user_id: actorUserId,
          },
        });

        // Record who the order is for, if Finance nominated someone. Written in
        // the same transaction as the debit so an approval can never be left
        // with a half-recorded nomination. upsert, because the unique index
        // allows only one nomination per proposal — re-approving replaces it.
        if (dto.assigned_faculty_id) {
          const faculty = await tx.faculty.findUnique({
            where: { id: dto.assigned_faculty_id },
            select: { id: true },
          });
          if (!faculty) {
            throw new NotFoundException({
              message: 'That faculty member does not exist',
              errorCode: 'FINANCE_FACULTY_NOT_FOUND',
            });
          }

          // Replace rather than accumulate: the database allows one nomination
          // per proposal, and re-approving should move it, not duplicate it.
          // Runs inside the approval transaction, so it commits or rolls back
          // together with the fund debit.
          const proposalRef =
            kind === 'pop'
              ? { purchase_order_proposal_id: id }
              : { service_order_proposal_id: id };

          await tx.finance_proposal_assignments.deleteMany({ where: proposalRef });
          await tx.finance_proposal_assignments.create({
            data: {
              ...proposalRef,
              faculty_id: dto.assigned_faculty_id,
              note: dto.assignment_note ?? null,
              assigned_by_user_id: actorUserId,
            },
          });
        }

        // ---------------------------------------------------------------
        // Place the order, so an approved proposal actually reaches Tracking.
        //
        // This was the missing link in the chain: approving only stamped the
        // proposal and debited the fund, while the Tracking screens list
        // purchase_orders / service_orders. Nothing created those, so an
        // approved item never appeared anywhere downstream. Creating the order
        // here — in the same transaction as the debit — is what makes
        // Approval -> Tracking -> Allotment -> History one continuous flow.
        //
        // Idempotent: proposal_id is UNIQUE on both order tables, so a retry
        // finds the existing order instead of creating a second one.
        const orderNumber = await this.nextOrderNumber(tx, kind);

        if (kind === 'pop') {
          const existing = await tx.purchase_orders.findUnique({
            where: { proposal_id: id },
            select: { id: true },
          });
          const order =
            existing ??
            (await tx.purchase_orders.create({
              data: {
                proposal_id: id,
                po_number: orderNumber,
                approved_by_user_id: actorUserId,
                approved_at: new Date(),
              },
              select: { id: true },
            }));

          // Start tracking it too, so it shows up with a real stage rather
          // than as an untracked row someone has to notice and enable.
          const tracked = await tx.finance_order_tracking.findUnique({
            where: { purchase_order_id: order.id },
            select: { id: true },
          });
          if (!tracked) {
            await tx.finance_order_tracking.create({
              data: {
                order_kind: 'purchase',
                purchase_order_id: order.id,
                quantity_ordered: quantityOrdered,
                created_by_user_id: actorUserId,
                remarks: 'Order placed on Finance approval',
              },
            });
          }
        } else {
          const existing = await tx.service_orders.findUnique({
            where: { proposal_id: id },
            select: { id: true },
          });
          const order =
            existing ??
            (await tx.service_orders.create({
              data: {
                proposal_id: id,
                so_number: orderNumber,
                approved_by_user_id: actorUserId,
                approved_at: new Date(),
              },
              select: { id: true },
            }));

          const tracked = await tx.finance_order_tracking.findUnique({
            where: { service_order_id: order.id },
            select: { id: true },
          });
          if (!tracked) {
            await tx.finance_order_tracking.create({
              data: {
                order_kind: 'service',
                service_order_id: order.id,
                quantity_ordered: quantityOrdered,
                created_by_user_id: actorUserId,
                remarks: 'Order placed on Finance approval',
              },
            });
          }
        }

        await this.audit.record({
          actorUserId,
          action: `${kind}.approved`,
          entityType: kind === 'pop' ? 'purchase_order_proposal' : 'service_order_proposal',
          entityId: id,
          before: { status: 'pending' },
          after: {
            status: 'finance_approved',
            amount: dto.amount,
            fund_id: fund.id,
            assigned_faculty_id: dto.assigned_faculty_id ?? null,
          },
          ipAddress: ctx.ip,
          userAgent: ctx.userAgent,
          tx,
        });

        const balance = await tx.finance_funds.findUniqueOrThrow({ where: { id: fund.id } });
        return {
          id: stamped.id,
          status: stamped.status,
          approved_amount: dto.amount,
          available_amount: Number(balance.available_amount),
        };
        }),
        `approving ${kind} ${id}`,
        this.logger,
      );
    } catch (err) {
      throw this.translate(err, `approving ${kind} ${id}`);
    }
  }

  private async rejectProposal(
    kind: ProposalKind,
    id: number,
    dto: DecideProposalDto,
    actorUserId: number,
    ctx: RequestContext,
  ) {
    const data = {
      status: 'rejected' as const,
      finance_reviewed_by: actorUserId,
      finance_reviewed_at: new Date(),
      finance_remarks: dto.remarks ?? null,
    };

    const updated =
      kind === 'pop'
        ? await this.prisma.purchase_order_proposals.update({ where: { id }, data })
        : await this.prisma.service_order_proposals.update({ where: { id }, data });

    await this.audit.record({
      actorUserId,
      action: `${kind}.rejected`,
      entityType: kind === 'pop' ? 'purchase_order_proposal' : 'service_order_proposal',
      entityId: id,
      before: { status: 'pending' },
      after: { status: 'rejected', remarks: dto.remarks },
      ipAddress: ctx.ip,
      userAgent: ctx.userAgent,
    });

    return { id: updated.id, status: updated.status, approved_amount: null };
  }

  private translate(err: unknown, whileDoing: string): Error {
    // A ConflictException raised deliberately inside the transaction (the
    // concurrency guard) must surface as-is, not be reinterpreted below.
    if (err instanceof ConflictException) return err;

    // Already translated by withDbRetry, or a connection fault that reached
    // here directly — either way it is not a 500.
    if (err instanceof ServiceUnavailableException) return err;
    if (isTransientDbError(err)) return dbUnavailable();

    const message = err instanceof Error ? err.message : String(err);

    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return new ConflictException({
        message: 'This proposal has already been paid out of the fund.',
        errorCode: 'FINANCE_ALREADY_DEBITED',
      });
    }
    if (message.includes('insufficient funds')) {
      return new ConflictException({
        message:
          'The fund does not hold enough money to approve this. Increase the total amount or release an existing commitment first.',
        errorCode: 'FINANCE_INSUFFICIENT_FUNDS',
      });
    }
    if (message.includes('is locked')) {
      return new ConflictException({
        message: 'That financial year is locked and cannot accept further movement.',
        errorCode: 'FINANCE_FUND_LOCKED',
      });
    }

    this.logger.error(`DB error while ${whileDoing}`, err);
    return new InternalServerErrorException({
      message: 'Something went wrong. Please try again.',
      errorCode: 'INTERNAL_ERROR',
    });
  }
}
