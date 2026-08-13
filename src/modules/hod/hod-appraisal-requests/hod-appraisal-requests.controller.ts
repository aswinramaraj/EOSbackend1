import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { ROLES } from 'src/common/constants/roles.constant';
import { HodAppraisalRequestsService } from './hod-appraisal-requests.service';

@Controller('hod/appraisal-requests')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.HOD)
export class HodAppraisalRequestsController {
  constructor(
    private readonly hodAppraisalRequestsService: HodAppraisalRequestsService,
  ) {}

  /** GET /api/v1/hod/appraisal-requests */
  @Get()
  getRequests(@CurrentUser() user: JwtPayload) {
    return this.hodAppraisalRequestsService.getRequests(user.sub);
  }

  /** GET /api/v1/hod/appraisal-requests/:id */
  @Get(':id')
  getRequestDetail(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.hodAppraisalRequestsService.getRequestDetail(
      user.sub,
      Number(id),
    );
  }

  /** PATCH /api/v1/hod/appraisal-requests/:id */
  @Patch(':id')
  decide(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body('decision') decision: 'approved' | 'rejected',
    @Body('remarks') remarks?: string,
  ) {
    return this.hodAppraisalRequestsService.decide(
      user.sub,
      Number(id),
      decision,
      remarks,
    );
  }
}
