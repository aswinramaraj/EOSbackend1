import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { ROLES } from 'src/common/constants/roles.constant';
import { HrQueriesService } from './hr-queries.service';
import { DecideHrPayrollRequestDto } from './dto/decide-hr-payroll-request.dto';

/**
 * HR Payroll's review queue over every staff member's HR payroll requests
 * (the tickets raised from the "HR Payroll" self-service tile - see
 * HrQueriesController). Approve/Reject is single-stage and HR-only, same
 * shape as payslip request review.
 */
@Controller('hr/payroll-requests')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.HR_PAYROLL, ROLES.ADMIN)
export class HrPayrollRequestsReviewController {
  constructor(private readonly hrQueriesService: HrQueriesService) {}

  /** GET /api/v1/hr/payroll-requests */
  @Get()
  list() {
    return this.hrQueriesService.listForReview();
  }

  /** PATCH /api/v1/hr/payroll-requests/:id/approve */
  @Patch(':id/approve')
  approve(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: DecideHrPayrollRequestDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.hrQueriesService.decide(id, 'approved', user.sub, dto.note);
  }

  /** PATCH /api/v1/hr/payroll-requests/:id/reject */
  @Patch(':id/reject')
  reject(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: DecideHrPayrollRequestDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.hrQueriesService.decide(id, 'rejected', user.sub, dto.note);
  }
}
