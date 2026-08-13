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
  HodOdRequestsService,
  type OdAudience,
  type OdTab,
} from './hod-od-requests.service';

/**
 * HoD OD Requests — HoD only. Unifies the student and faculty on-duty
 * approval chains behind one Student/Faculty toggle, each re-verified
 * against the caller's own department server-side.
 */
@Controller('hod/od-requests')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.HOD)
export class HodOdRequestsController {
  constructor(private readonly hodOdRequestsService: HodOdRequestsService) {}

  /** GET /api/v1/hod/od-requests?audience=student|faculty&tab=pending|approved|rejected|all */
  @Get()
  getList(
    @CurrentUser() user: JwtPayload,
    @Query('audience') audience: OdAudience = 'student',
    @Query('tab') tab: OdTab = 'pending',
  ) {
    return this.hodOdRequestsService.getList(user.sub, audience, tab);
  }

  /** PATCH /api/v1/hod/od-requests/:kind/:id { decision: 'approved'|'rejected' } */
  @Patch(':kind/:id')
  decide(
    @CurrentUser() user: JwtPayload,
    @Param('kind') kind: OdAudience,
    @Param('id', ParseIntPipe) id: number,
    @Body('decision') decision: 'approved' | 'rejected',
  ) {
    return this.hodOdRequestsService.decide(user.sub, kind, id, decision);
  }
}
