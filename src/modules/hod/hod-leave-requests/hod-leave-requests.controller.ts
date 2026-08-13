import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { ROLES } from 'src/common/constants/roles.constant';
import {
  HodLeaveRequestsService,
  type LeaveAudience,
  type LeaveTab,
} from './hod-leave-requests.service';

/**
 * HoD Leave Requests — HoD only. Unifies the student and faculty leave
 * chains behind one Student/Faculty toggle, each re-verified against the
 * caller's own department server-side.
 */
@Controller('hod/leave-requests')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.HOD)
export class HodLeaveRequestsController {
  constructor(
    private readonly hodLeaveRequestsService: HodLeaveRequestsService,
  ) {}

  /** GET /api/v1/hod/leave-requests?audience=student|faculty&tab=pending|approved|rejected|all */
  @Get()
  getList(
    @CurrentUser() user: JwtPayload,
    @Query('audience') audience: LeaveAudience = 'student',
    @Query('tab') tab: LeaveTab = 'pending',
  ) {
    return this.hodLeaveRequestsService.getList(user.sub, audience, tab);
  }

  /** PATCH /api/v1/hod/leave-requests/:kind/:id { decision: 'approved'|'rejected' } */
  @Patch(':kind/:id')
  decide(
    @CurrentUser() user: JwtPayload,
    @Param('kind') kind: LeaveAudience,
    @Param('id', ParseIntPipe) id: number,
    @Body('decision') decision: 'approved' | 'rejected',
  ) {
    return this.hodLeaveRequestsService.decide(user.sub, kind, id, decision);
  }
}
