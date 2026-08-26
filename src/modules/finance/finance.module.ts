import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { FinanceAuditService } from './finance-audit.service';
import { FinanceFundController } from './fund/fund.controller';
import { FinanceFundService } from './fund/fund.service';
import { FinanceApprovalsController } from './approvals/approvals.controller';
import { FinanceApprovalsService } from './approvals/approvals.service';
import { FinanceTrackingController } from './tracking/tracking.controller';
import { FinanceTrackingService } from './tracking/tracking.service';
import { FinanceDashboardController } from './dashboard/dashboard.controller';
import { FinanceDashboardService } from './dashboard/dashboard.service';

/**
 * The Finance module: the institution's own money pot, POP/SOP financial
 * approval, delivery tracking, and faculty allotment of what arrives.
 *
 * Announcements are deliberately NOT re-implemented here — the Finance portal
 * reuses the shared /announcements endpoints (with ROLES.FINANCE added to
 * them), so there is one announcement system for the whole platform rather
 * than a per-module copy.
 */
@Module({
  imports: [PrismaModule],
  controllers: [
    FinanceDashboardController,
    FinanceFundController,
    FinanceApprovalsController,
    FinanceTrackingController,
  ],
  providers: [
    FinanceAuditService,
    FinanceFundService,
    FinanceApprovalsService,
    FinanceTrackingService,
    FinanceDashboardService,
  ],
})
export class FinanceModule {}
