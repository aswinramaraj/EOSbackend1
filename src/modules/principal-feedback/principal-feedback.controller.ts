import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { ROLES } from 'src/common/constants/roles.constant';
import { PrincipalFeedbackService } from './principal-feedback.service';

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
  @Get('overview')
  getOverview(@Query('department_id') departmentId?: string, @Query('batch_id') batchId?: string) {
    return this.service.getOverview({
      departmentId: departmentId ? Number(departmentId) : undefined,
      batchId: batchId ? Number(batchId) : undefined,
    });
  }
}
