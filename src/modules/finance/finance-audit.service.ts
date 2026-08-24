import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from 'generated/prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';

/**
 * Writes the Finance module's own audit trail (`finance_audit_log`).
 *
 * Deliberately separate from the Billing module's AuditLogService: that one
 * writes to `audit_logs`, which is scoped to fee/billing entities. Finance
 * needs its own immutable trail because the DB blocks UPDATE/DELETE on
 * `finance_audit_log` (append-only trigger), which `audit_logs` does not do.
 *
 * Recording an audit row must never be the reason a legitimate financial
 * action fails, so failures here are logged and swallowed. The money itself
 * is already protected by database constraints, not by this log.
 */
@Injectable()
export class FinanceAuditService {
  private readonly logger = new Logger(FinanceAuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(entry: {
    actorUserId: number;
    action: string;
    entityType: string;
    entityId?: number | null;
    before?: unknown;
    after?: unknown;
    ipAddress?: string | null;
    userAgent?: string | null;
    /**
     * When the caller is already inside a transaction, pass its client so the
     * audit row commits or rolls back together with the change it describes.
     */
    tx?: Prisma.TransactionClient;
  }): Promise<void> {
    const client = entry.tx ?? this.prisma;
    try {
      await client.finance_audit_log.create({
        data: {
          actor_user_id: entry.actorUserId,
          action: entry.action,
          entity_type: entry.entityType,
          entity_id: entry.entityId ?? null,
          before_data:
            entry.before === undefined ? undefined : (entry.before as Prisma.InputJsonValue),
          after_data:
            entry.after === undefined ? undefined : (entry.after as Prisma.InputJsonValue),
          ip_address: entry.ipAddress ?? null,
          // The column is VARCHAR(300); a browser UA can exceed that.
          user_agent: entry.userAgent ? entry.userAgent.slice(0, 300) : null,
        },
      });
    } catch (err) {
      this.logger.error(
        `Failed to write finance audit entry (${entry.action} on ${entry.entityType})`,
        err,
      );
    }
  }
}
