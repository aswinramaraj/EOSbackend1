import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { ROLES } from 'src/common/constants/roles.constant';
import { HodSopPopRequestsService } from './hod-sop-pop-requests.service';

@Controller('hod/sop-pop-requests')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.HOD)
export class HodSopPopRequestsController {
  constructor(
    private readonly hodSopPopRequestsService: HodSopPopRequestsService,
  ) {}

  /** GET /api/v1/hod/sop-pop-requests */
  @Get()
  getRequests(@CurrentUser() user: JwtPayload) {
    return this.hodSopPopRequestsService.getRequests(user.sub);
  }

  /** PATCH /api/v1/hod/sop-pop-requests/:kind/:id */
  @Patch(':kind/:id')
  decide(
    @CurrentUser() user: JwtPayload,
    @Param('kind') kind: 'sop' | 'pop',
    @Param('id') id: string,
    @Body('decision') decision: 'approved' | 'rejected',
    @Body('remarks') remarks?: string,
  ) {
    return this.hodSopPopRequestsService.decide(
      user.sub,
      kind,
      Number(id),
      decision,
      remarks,
    );
  }
}
