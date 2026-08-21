import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { ROLES } from 'src/common/constants/roles.constant';
import { AuditLogService } from './audit-log.service';

@Controller('audit-logs')
@Roles(ROLES.ADMIN, ROLES.BILLING)
@UseGuards(JwtAuthGuard, RolesGuard)
export class AuditLogController {
  constructor(private readonly auditLogService: AuditLogService) {}

  /**
   * GET /api/v1/audit-logs?entity_type=&action=&q=
   *
   * Scoped server-side to fees-billing entity types only — the Billing
   * Portal's Audit Log screen never sees rows written by other modules
   * (e.g. placement/drives.service.ts) that share this same audit_logs
   * table.
   *
   * Error responses:
   *  401 UNAUTHORIZED   – missing/invalid access token
   *  403 FORBIDDEN      – authenticated user is not admin/billing
   *  500 INTERNAL_ERROR – unexpected server failure
   */
  @Get()
  findAll(
    @Query('entity_type') entity_type?: string,
    @Query('action') action?: string,
    @Query('q') q?: string,
  ) {
    return this.auditLogService.findAll({ entity_type, action, q });
  }
}
