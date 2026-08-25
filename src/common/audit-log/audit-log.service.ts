import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { Prisma } from '../../../generated/prisma/client';

export interface RecordAuditLogInput {
  entityType: string;
  entityId: number;
  action: string;
  performedByUserId: number;
  newValue?: Record<string, unknown>;
  oldValue?: Record<string, unknown>;
  reason?: string;
}

/**
 * Thin wrapper over the real, pre-existing `audit_logs` table — committed in
 * schema.prisma since before this module existed, but never written to by
 * any code anywhere in the backend until now. No schema change. `record()`
 * swallows its own errors (logs, never throws) so a logging failure can
 * never break the real action it's attached to.
 */
@Injectable()
export class AuditLogService {
  private readonly logger = new Logger(AuditLogService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(input: RecordAuditLogInput): Promise<void> {
    try {
      await this.prisma.audit_logs.create({
        data: {
          entity_type: input.entityType,
          entity_id: input.entityId,
          action: input.action,
          performed_by_user_id: input.performedByUserId,
          new_value: input.newValue as Prisma.InputJsonValue | undefined,
          old_value: input.oldValue as Prisma.InputJsonValue | undefined,
          reason: input.reason,
        },
      });
    } catch (err) {
      this.logger.error('Failed to write audit log', err as Error);
    }
  }
}
