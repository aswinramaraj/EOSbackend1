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
import type { RequestContext } from '../fund/fund.service';
import {
  CreateAllotmentDto,
  CreateTrackingDto,
  UpdateAllotmentDto,
  UpdateTrackingDto,
} from './dto/tracking.dto';

export type OrderKind = 'purchase' | 'service';

export interface TrackingEventView {
  id: string;
  from_status: string | null;
  to_status: string;
  note: string | null;
  changed_by: string | null;
  changed_at: string;
}

export interface AllotmentView {
  id: number;
  faculty_id: number;
  faculty_name: string;
  faculty_designation: string | null;
  faculty_department: string | null;
  quantity: number;
  remarks: string | null;
  allotted_at: string;
  allotted_by: string | null;
}

export interface TrackingView {
  id: number;
  order_kind: OrderKind;
  order_id: number;
  order_number: string;
  proposal_id: number;
  title: string;
  description: string | null;
  department: string | null;
  requested_by: string | null;
  vendor: string | null;
  approved_amount: number | null;
  delivery_status: string;
  expected_delivery_date: string | null;
  delivered_at: string | null;
  quantity_ordered: number | null;
  quantity_delivered: number;
  quantity_allotted: number;
  tracking_reference: string | null;
  remarks: string | null;
  order_placed_at: string;
  events: TrackingEventView[];
  allotments: AllotmentView[];
  /** True once delivered and fully allotted — i.e. it belongs in History. */
  is_closed: boolean;
}

@Injectable()
export class FinanceTrackingService {
  private readonly logger = new Logger(FinanceTrackingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: FinanceAuditService,
  ) {}

  /**
   * GET /finance/tracking/:kind
   *
   * Every placed order of that kind, with its tracking state if it has one.
   * Orders with no tracking row yet are still returned (as `ordered` with no
   * events) so Finance can see and start tracking them — otherwise a freshly
   * placed order would simply be invisible on this screen.
   */
  async list(kind: OrderKind): Promise<TrackingView[]> {
    const trackingRows = await this.prisma.finance_order_tracking.findMany({
      where: { order_kind: kind },
      include: {
        finance_order_tracking_events: {
          orderBy: { changed_at: 'asc' },
          include: { users: { select: { email: true } } },
        },
        finance_order_allotments: {
          orderBy: { allotted_at: 'desc' },
          include: {
            faculty: {
              select: {
                id: true,
                first_name: true,
                last_name: true,
                designation: true,
                departments: { select: { name: true } },
              },
            },
            users: { select: { email: true } },
          },
        },
      },
    });

    const byOrderId = new Map<number, (typeof trackingRows)[number]>();
    for (const t of trackingRows) {
      const key = kind === 'purchase' ? t.purchase_order_id : t.service_order_id;
      if (key !== null) byOrderId.set(key, t);
    }

    if (kind === 'purchase') {
      const orders = await this.prisma.purchase_orders.findMany({
        orderBy: { id: 'desc' },
        include: {
          purchase_order_proposals: {
            include: {
              purchase_indents: {
                include: {
                  departments: { select: { name: true } },
                  users: { select: { email: true } },
                },
              },
              vendors: { select: { name: true } },
            },
          },
        },
      });

      const debits = await this.debitMap(
        'purchase',
        orders.map((o) => o.proposal_id),
      );

      return orders.map((o) => {
        const p = o.purchase_order_proposals;
        const ind = p.purchase_indents;
        return this.compose({
          tracking: byOrderId.get(o.id),
          kind: 'purchase',
          orderId: o.id,
          orderNumber: o.po_number,
          proposalId: p.id,
          title: ind.item_name,
          description: ind.purpose,
          department: ind.departments?.name ?? null,
          requestedBy: ind.users?.email ?? null,
          vendor: p.vendors?.name ?? null,
          approvedAmount: debits.get(p.id) ?? null,
          defaultQuantity: ind.quantity,
          placedAt: o.created_at,
        });
      });
    }

    const orders = await this.prisma.service_orders.findMany({
      orderBy: { id: 'desc' },
      include: {
        service_order_proposals: {
          include: {
            service_indents: {
              include: {
                departments: { select: { name: true } },
                users: { select: { email: true } },
              },
            },
            vendors: { select: { name: true } },
          },
        },
      },
    });

    const debits = await this.debitMap(
      'service',
      orders.map((o) => o.proposal_id),
    );

    return orders.map((o) => {
      const p = o.service_order_proposals;
      const ind = p.service_indents;
      return this.compose({
        tracking: byOrderId.get(o.id),
        kind: 'service',
        orderId: o.id,
        orderNumber: o.so_number,
        proposalId: p.id,
        title: ind.title ?? ind.service_description.slice(0, 120),
        description: ind.service_description,
        department: ind.departments?.name ?? null,
        requestedBy: ind.users?.email ?? null,
        vendor: p.vendors?.name ?? null,
        approvedAmount: debits.get(p.id) ?? null,
        defaultQuantity: null,
        placedAt: o.created_at,
      });
    });
  }

  /** Committed amount per proposal, net of reversals — see the same helper in
   *  FinanceApprovalsService for why the raw debit alone would be wrong. */
  private async debitMap(kind: OrderKind, proposalIds: number[]): Promise<Map<number, number>> {
    if (proposalIds.length === 0) return new Map();
    const idField =
      kind === 'purchase' ? 'purchase_order_proposal_id' : 'service_order_proposal_id';
    const rows = await this.prisma.finance_ledger_entries.findMany({
      where: {
        [idField]: { in: proposalIds },
        source: {
          in: [kind === 'purchase' ? 'pop_approval' : 'sop_approval', 'order_cancellation'],
        },
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
      const key = kind === 'purchase' ? r.purchase_order_proposal_id : r.service_order_proposal_id;
      if (key === null) continue;
      const signed = r.entry_type === 'debit' ? Number(r.amount) : -Number(r.amount);
      map.set(key, (map.get(key) ?? 0) + signed);
    }
    for (const [key, net] of map) {
      if (net <= 0) map.delete(key);
    }
    return map;
  }

  private compose(input: {
    tracking?: {
      id: number;
      delivery_status: string;
      expected_delivery_date: Date | null;
      delivered_at: Date | null;
      quantity_ordered: number | null;
      quantity_delivered: number;
      tracking_reference: string | null;
      remarks: string | null;
      finance_order_tracking_events: Array<{
        id: bigint;
        from_status: string | null;
        to_status: string;
        note: string | null;
        changed_at: Date;
        users: { email: string } | null;
      }>;
      finance_order_allotments: Array<{
        id: number;
        quantity: number;
        remarks: string | null;
        allotted_at: Date;
        faculty: {
          id: number;
          first_name: string;
          last_name: string;
          designation: string | null;
          departments: { name: string } | null;
        };
        users: { email: string } | null;
      }>;
    };
    kind: OrderKind;
    orderId: number;
    orderNumber: string;
    proposalId: number;
    title: string;
    description: string | null;
    department: string | null;
    requestedBy: string | null;
    vendor: string | null;
    approvedAmount: number | null;
    defaultQuantity: number | null;
    placedAt: Date;
  }): TrackingView {
    const t = input.tracking;
    const allotted = (t?.finance_order_allotments ?? []).reduce((s, a) => s + a.quantity, 0);
    const delivered = t?.quantity_delivered ?? 0;

    return {
      // id 0 marks "not tracked yet" — the UI shows a Start tracking action.
      id: t?.id ?? 0,
      order_kind: input.kind,
      order_id: input.orderId,
      order_number: input.orderNumber,
      proposal_id: input.proposalId,
      title: input.title,
      description: input.description,
      department: input.department,
      requested_by: input.requestedBy,
      vendor: input.vendor,
      approved_amount: input.approvedAmount,
      delivery_status: t?.delivery_status ?? 'ordered',
      expected_delivery_date: t?.expected_delivery_date?.toISOString() ?? null,
      delivered_at: t?.delivered_at?.toISOString() ?? null,
      quantity_ordered: t?.quantity_ordered ?? input.defaultQuantity,
      quantity_delivered: delivered,
      quantity_allotted: allotted,
      tracking_reference: t?.tracking_reference ?? null,
      remarks: t?.remarks ?? null,
      order_placed_at: input.placedAt.toISOString(),
      events: (t?.finance_order_tracking_events ?? []).map((e) => ({
        id: e.id.toString(),
        from_status: e.from_status,
        to_status: e.to_status,
        note: e.note,
        changed_by: e.users?.email ?? null,
        changed_at: e.changed_at.toISOString(),
      })),
      allotments: (t?.finance_order_allotments ?? []).map((a) => ({
        id: a.id,
        faculty_id: a.faculty.id,
        faculty_name: `${a.faculty.first_name} ${a.faculty.last_name}`.trim(),
        faculty_designation: a.faculty.designation,
        faculty_department: a.faculty.departments?.name ?? null,
        quantity: a.quantity,
        remarks: a.remarks,
        allotted_at: a.allotted_at.toISOString(),
        allotted_by: a.users?.email ?? null,
      })),
      is_closed:
        (t?.delivery_status === 'delivered' || t?.delivery_status === 'cancelled') &&
        (delivered === 0 || allotted >= delivered),
    };
  }

  /** POST /finance/tracking — begin tracking a placed order. */
  async create(dto: CreateTrackingDto, actorUserId: number, ctx: RequestContext) {
    // The order must genuinely exist before we hang tracking off it.
    const exists =
      dto.order_kind === 'purchase'
        ? await this.prisma.purchase_orders.findUnique({ where: { id: dto.order_id } })
        : await this.prisma.service_orders.findUnique({ where: { id: dto.order_id } });

    if (!exists) {
      throw new NotFoundException({
        message: 'That order does not exist',
        errorCode: 'FINANCE_ORDER_NOT_FOUND',
      });
    }

    try {
      const created = await this.prisma.finance_order_tracking.create({
        data: {
          order_kind: dto.order_kind,
          purchase_order_id: dto.order_kind === 'purchase' ? dto.order_id : null,
          service_order_id: dto.order_kind === 'service' ? dto.order_id : null,
          quantity_ordered: dto.quantity_ordered ?? null,
          expected_delivery_date: dto.expected_delivery_date
            ? new Date(dto.expected_delivery_date)
            : null,
          tracking_reference: dto.tracking_reference ?? null,
          remarks: dto.remarks ?? null,
          created_by_user_id: actorUserId,
        },
      });

      await this.audit.record({
        actorUserId,
        action: 'tracking.created',
        entityType: 'finance_order_tracking',
        entityId: created.id,
        after: { order_kind: dto.order_kind, order_id: dto.order_id },
        ipAddress: ctx.ip,
        userAgent: ctx.userAgent,
      });

      return { id: created.id };
    } catch (err) {
      throw this.translate(err, 'starting order tracking');
    }
  }

  /** PUT /finance/tracking/:id — advance the delivery state. */
  async update(id: number, dto: UpdateTrackingDto, actorUserId: number, ctx: RequestContext) {
    const current = await this.prisma.finance_order_tracking.findUnique({ where: { id } });
    if (!current) {
      throw new NotFoundException({
        message: 'That tracking record does not exist',
        errorCode: 'FINANCE_TRACKING_NOT_FOUND',
      });
    }

    // Marking delivered without saying how many arrived would leave allotment
    // unbounded, so require a quantity whenever one was ordered.
    const nextStatus = dto.delivery_status ?? current.delivery_status;
    const nextDelivered = dto.quantity_delivered ?? current.quantity_delivered;
    const nextOrdered = dto.quantity_ordered ?? current.quantity_ordered;

    if (
      (nextStatus === 'delivered' || nextStatus === 'partially_delivered') &&
      nextOrdered !== null &&
      nextDelivered <= 0
    ) {
      throw new BadRequestException({
        message: 'Enter how many units were delivered before marking this delivered',
        errorCode: 'FINANCE_DELIVERED_QTY_REQUIRED',
      });
    }

    try {
      const updated = await this.prisma.finance_order_tracking.update({
        where: { id },
        data: {
          delivery_status: dto.delivery_status ?? undefined,
          quantity_delivered: dto.quantity_delivered ?? undefined,
          quantity_ordered: dto.quantity_ordered ?? undefined,
          expected_delivery_date: dto.expected_delivery_date
            ? new Date(dto.expected_delivery_date)
            : undefined,
          tracking_reference: dto.tracking_reference ?? undefined,
          remarks: dto.remarks ?? undefined,
          updated_by_user_id: actorUserId,
        },
      });

      await this.audit.record({
        actorUserId,
        action: 'tracking.updated',
        entityType: 'finance_order_tracking',
        entityId: id,
        before: {
          delivery_status: current.delivery_status,
          quantity_delivered: current.quantity_delivered,
        },
        after: {
          delivery_status: updated.delivery_status,
          quantity_delivered: updated.quantity_delivered,
        },
        ipAddress: ctx.ip,
        userAgent: ctx.userAgent,
      });

      return { id: updated.id, delivery_status: updated.delivery_status };
    } catch (err) {
      throw this.translate(err, 'updating order tracking');
    }
  }

  /** GET /finance/tracking/faculty-search?q= — the allotment picker. */
  async searchFaculty(q?: string) {
    const term = (q ?? '').trim();
    const rows = await this.prisma.faculty.findMany({
      where: {
        status: 'active',
        ...(term
          ? {
              OR: [
                { first_name: { contains: term, mode: 'insensitive' as const } },
                { last_name: { contains: term, mode: 'insensitive' as const } },
                { staff_code: { contains: term, mode: 'insensitive' as const } },
                { users: { email: { contains: term, mode: 'insensitive' as const } } },
              ],
            }
          : {}),
      },
      orderBy: [{ first_name: 'asc' }],
      take: 25,
      select: {
        id: true,
        first_name: true,
        last_name: true,
        designation: true,
        staff_code: true,
        departments: { select: { name: true } },
        users: { select: { email: true } },
      },
    });

    return rows.map((f) => ({
      id: f.id,
      name: `${f.first_name} ${f.last_name}`.trim(),
      designation: f.designation,
      staff_code: f.staff_code,
      department: f.departments?.name ?? null,
      email: f.users?.email ?? null,
    }));
  }

  /** POST /finance/tracking/:id/allotments — hand it to a faculty member. */
  async allot(
    trackingId: number,
    dto: CreateAllotmentDto,
    actorUserId: number,
    ctx: RequestContext,
  ) {
    const tracking = await this.prisma.finance_order_tracking.findUnique({
      where: { id: trackingId },
    });
    if (!tracking) {
      throw new NotFoundException({
        message: 'That tracking record does not exist',
        errorCode: 'FINANCE_TRACKING_NOT_FOUND',
      });
    }

    const faculty = await this.prisma.faculty.findUnique({ where: { id: dto.faculty_id } });
    if (!faculty) {
      throw new NotFoundException({
        message: 'That faculty member does not exist',
        errorCode: 'FINANCE_FACULTY_NOT_FOUND',
      });
    }

    try {
      const created = await this.prisma.finance_order_allotments.create({
        data: {
          tracking_id: trackingId,
          faculty_id: dto.faculty_id,
          quantity: dto.quantity ?? 1,
          remarks: dto.remarks ?? null,
          allotted_by_user_id: actorUserId,
        },
      });

      await this.audit.record({
        actorUserId,
        action: 'allotment.created',
        entityType: 'finance_order_allotment',
        entityId: created.id,
        after: {
          tracking_id: trackingId,
          faculty_id: dto.faculty_id,
          quantity: created.quantity,
        },
        ipAddress: ctx.ip,
        userAgent: ctx.userAgent,
      });

      return { id: created.id };
    } catch (err) {
      throw this.translate(err, 'allotting the order');
    }
  }

  /** PUT /finance/allotments/:id */
  async updateAllotment(
    id: number,
    dto: UpdateAllotmentDto,
    actorUserId: number,
    ctx: RequestContext,
  ) {
    const current = await this.prisma.finance_order_allotments.findUnique({ where: { id } });
    if (!current) {
      throw new NotFoundException({
        message: 'That allotment does not exist',
        errorCode: 'FINANCE_ALLOTMENT_NOT_FOUND',
      });
    }

    if (dto.faculty_id) {
      const faculty = await this.prisma.faculty.findUnique({ where: { id: dto.faculty_id } });
      if (!faculty) {
        throw new NotFoundException({
          message: 'That faculty member does not exist',
          errorCode: 'FINANCE_FACULTY_NOT_FOUND',
        });
      }
    }

    try {
      const updated = await this.prisma.finance_order_allotments.update({
        where: { id },
        data: {
          faculty_id: dto.faculty_id ?? undefined,
          quantity: dto.quantity ?? undefined,
          remarks: dto.remarks ?? undefined,
        },
      });

      await this.audit.record({
        actorUserId,
        action: 'allotment.updated',
        entityType: 'finance_order_allotment',
        entityId: id,
        before: { faculty_id: current.faculty_id, quantity: current.quantity },
        after: { faculty_id: updated.faculty_id, quantity: updated.quantity },
        ipAddress: ctx.ip,
        userAgent: ctx.userAgent,
      });

      return { id: updated.id };
    } catch (err) {
      throw this.translate(err, 'updating the allotment');
    }
  }

  /**
   * DELETE /finance/allotments/:id
   *
   * Allotments are operational (who holds the asset), not financial, so they
   * may be corrected/removed. The money movement behind the order stays in the
   * ledger and is never touched here.
   */
  async removeAllotment(id: number, actorUserId: number, ctx: RequestContext) {
    const current = await this.prisma.finance_order_allotments.findUnique({ where: { id } });
    if (!current) {
      throw new NotFoundException({
        message: 'That allotment does not exist',
        errorCode: 'FINANCE_ALLOTMENT_NOT_FOUND',
      });
    }

    await this.prisma.finance_order_allotments.delete({ where: { id } });

    await this.audit.record({
      actorUserId,
      action: 'allotment.deleted',
      entityType: 'finance_order_allotment',
      entityId: id,
      before: {
        tracking_id: current.tracking_id,
        faculty_id: current.faculty_id,
        quantity: current.quantity,
      },
      ipAddress: ctx.ip,
      userAgent: ctx.userAgent,
    });

    return { id };
  }

  private translate(err: unknown, whileDoing: string): Error {
    const message = err instanceof Error ? err.message : String(err);

    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return new ConflictException({
        message: 'This order is already being tracked.',
        errorCode: 'FINANCE_TRACKING_EXISTS',
      });
    }
    if (message.includes('cannot allot an order that is not delivered')) {
      return new ConflictException({
        message: 'Mark the order delivered before allotting it to a faculty member.',
        errorCode: 'FINANCE_NOT_DELIVERED',
      });
    }
    if (message.includes('would exceed the delivered quantity')) {
      return new ConflictException({
        message: 'That would allot more units than were delivered.',
        errorCode: 'FINANCE_ALLOTMENT_EXCEEDS_DELIVERED',
      });
    }
    if (message.includes('cannot move from')) {
      return new ConflictException({
        message: 'A delivered or cancelled order cannot be moved back to an earlier step.',
        errorCode: 'FINANCE_TRACKING_REGRESSION',
      });
    }
    if (message.includes('finance_order_tracking_quantities_check')) {
      return new ConflictException({
        message: 'The delivered quantity cannot exceed the ordered quantity.',
        errorCode: 'FINANCE_QUANTITY_INVALID',
      });
    }

    this.logger.error(`DB error while ${whileDoing}`, err);
    return new InternalServerErrorException({
      message: 'Something went wrong. Please try again.',
      errorCode: 'INTERNAL_ERROR',
    });
  }
}
