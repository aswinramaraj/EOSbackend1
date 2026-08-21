import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { Prisma } from '../../../../generated/prisma/client';

/**
 * entity_type values written by the Billing Portal's own mutations — the
 * only ones this endpoint ever returns, so the Billing Portal never sees
 * unrelated rows written by other modules (e.g. placement/drives) that
 * also happen to live in the shared `audit_logs` table.
 */
const BILLING_ENTITY_TYPES = [
  'fee_payment',
  'fee_concession',
  'education_loan_dd',
  'demand_category',
  'fee_structure',
  'fee_structure_item',
  'quota',
  'announcement',
] as const;

type BillingEntityType = (typeof BILLING_ENTITY_TYPES)[number];

export interface FindAuditLogsFilters {
  entity_type?: string;
  action?: string;
  q?: string;
}

/**
 * Renders a short, human-readable "Detail" string for one audit_logs row —
 * matching the tone of the design mockup's fake AUDIT array (e.g.
 * "RCPT-1042 · ₹25,000 · UPI") rather than dumping raw JSON at the caller.
 */
function synthesizeDetail(row: {
  entity_type: string;
  action: string;
  old_value: Prisma.JsonValue | null;
  new_value: Prisma.JsonValue | null;
}): string {
  const nv = (row.new_value ?? {}) as Record<string, unknown>;
  const ov = (row.old_value ?? {}) as Record<string, unknown>;
  const money = (v: unknown) =>
    v === undefined || v === null ? null : `₹${Number(v).toLocaleString('en-IN')}`;

  switch (row.entity_type) {
    case 'fee_payment': {
      const parts = [nv.receipt_no, money(nv.amount_paid), nv.payment_mode].filter(Boolean);
      return parts.length ? parts.join(' · ') : 'Fee payment recorded';
    }
    case 'fee_concession': {
      const amt = money(nv.concession_amount ?? ov.concession_amount);
      if (row.action === 'deleted') return `Concession removed${amt ? ' · ' + amt : ''}`;
      return [amt, nv.is_settled ? 'settled' : null].filter(Boolean).join(' · ') || 'Fee concession';
    }
    case 'education_loan_dd': {
      const parts = [nv.dd_reference_number ?? ov.dd_reference_number, nv.bank_name ?? ov.bank_name].filter(Boolean);
      return parts.length ? parts.join(' · ') : 'Education loan DD';
    }
    case 'demand_category': {
      return String(nv.name ?? ov.name ?? 'Demand category');
    }
    case 'fee_structure': {
      return String(nv.name ?? ov.name ?? 'Fee structure');
    }
    case 'fee_structure_item': {
      const amt = money(nv.amount ?? ov.amount);
      return amt ? `Fee structure item · ${amt}` : 'Fee structure item';
    }
    case 'quota': {
      return String(nv.name ?? ov.name ?? 'Quota');
    }
    case 'announcement': {
      return String(nv.title ?? ov.title ?? 'Announcement');
    }
    default:
      return row.entity_type;
  }
}

/** "created" -> "Fee Concession Created", matching design's Title Case action labels. */
function humanizeAction(entityType: string, action: string): string {
  const entityLabel: Record<string, string> = {
    fee_payment: 'Payment',
    fee_concession: 'Concession',
    education_loan_dd: 'Education loan DD',
    demand_category: 'Demand category',
    fee_structure: 'Fee structure',
    fee_structure_item: 'Fee structure item',
    quota: 'Quota',
    announcement: 'Announcement',
  };
  const actionLabel: Record<string, string> = {
    created: 'created',
    updated: 'updated',
    deleted: 'deleted',
    settled: 'settled',
  };
  const entity = entityLabel[entityType] ?? entityType;
  const act = actionLabel[action] ?? action;
  return entityType === 'fee_payment' && action === 'created'
    ? 'Payment received'
    : `${entity} ${act}`;
}

@Injectable()
export class AuditLogService {
  private readonly logger = new Logger(AuditLogService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * GET /audit-logs — scoped to fees-billing entity types only, so the
   * Billing Portal never sees audit entries written by other modules
   * (e.g. placement/drives.service.ts) that share this same table.
   */
  async findAll(filters: FindAuditLogsFilters) {
    const entityTypes: readonly string[] =
      filters.entity_type && (BILLING_ENTITY_TYPES as readonly string[]).includes(filters.entity_type)
        ? [filters.entity_type]
        : BILLING_ENTITY_TYPES;

    try {
      const rows = await this.prisma.audit_logs.findMany({
        where: {
          entity_type: { in: [...entityTypes] },
          ...(filters.action ? { action: filters.action } : {}),
        },
        include: {
          users: {
            select: {
              email: true,
              faculty: { select: { first_name: true, last_name: true } },
            },
          },
        },
        orderBy: { performed_at: 'desc' },
        take: 500,
      });

      const mapped = rows.map((row) => {
        const actorName = row.users.faculty
          ? [row.users.faculty.first_name, row.users.faculty.last_name].filter(Boolean).join(' ')
          : row.users.email;

        return {
          id: row.id,
          entity_type: row.entity_type,
          entity_id: row.entity_id,
          action: humanizeAction(row.entity_type, row.action),
          raw_action: row.action,
          detail: synthesizeDetail(row),
          actor: actorName,
          time: row.performed_at,
        };
      });

      if (!filters.q) return mapped;

      const q = filters.q.toLowerCase();
      return mapped.filter(
        (row) =>
          row.action.toLowerCase().includes(q) ||
          row.detail.toLowerCase().includes(q) ||
          row.actor.toLowerCase().includes(q),
      );
    } catch (err) {
      this.logger.error('DB error while fetching audit logs', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * Fire-and-forget audit write used by every fees-billing mutation.
   * Never throws — a failed audit write must never roll back or fail the
   * real payment/concession/etc operation it's recording.
   */
  async record(entry: {
    entity_type: BillingEntityType;
    entity_id: number;
    action: string;
    performed_by_user_id: number;
    old_value?: Record<string, unknown>;
    new_value?: Record<string, unknown>;
  }): Promise<void> {
    try {
      await this.prisma.audit_logs.create({
        data: {
          entity_type: entry.entity_type,
          entity_id: entry.entity_id,
          action: entry.action,
          performed_by_user_id: entry.performed_by_user_id,
          old_value: entry.old_value as Prisma.InputJsonValue | undefined,
          new_value: entry.new_value as Prisma.InputJsonValue | undefined,
        },
      });
    } catch (err) {
      this.logger.error(
        `Failed to write audit log for ${entry.entity_type}#${entry.entity_id} (${entry.action})`,
        err,
      );
    }
  }
}
