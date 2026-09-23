import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { ROLES } from 'src/common/constants/roles.constant';
import { FEEDBACK_TYPES, PrincipalFeedbackService, type FeedbackType } from './principal-feedback.service';

@Controller('principal-feedback')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.CORRESPONDENT, ROLES.PRINCIPAL)
export class PrincipalFeedbackController {
  constructor(private readonly service: PrincipalFeedbackService) {}

  /**
   * GET /principal-feedback/overview?department_id=&batch_id= —
   * institution-wide form/response rollup + recent-forms breakdown,
   * optionally narrowed to forms scoped to a given department (via the
   * form's class) and/or batch.
   */
  /**
   * GET /principal-feedback/insights?type=&department_id= — every kind of
   * feedback in one rollup (academic forms, campus service reviews, hostel
   * mess, parent feedback), for the Principal's Campus-tab Feedback page.
   * `type`: all (default) | academic | service | mess | parent.
   */
  @Get('insights')
  getInsights(@Query('type') type?: string, @Query('department_id') departmentId?: string) {
    return this.service.getInsights({
      type: FEEDBACK_TYPES.includes(type as FeedbackType) ? (type as FeedbackType) : undefined,
      departmentId: departmentId ? Number(departmentId) : undefined,
    });
  }

  @Get('overview')
  getOverview(@Query('department_id') departmentId?: string, @Query('batch_id') batchId?: string) {
    return this.service.getOverview({
      departmentId: departmentId ? Number(departmentId) : undefined,
      batchId: batchId ? Number(batchId) : undefined,
    });
  }
}
