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
import { HodApprovalsService } from './hod-approvals.service';
import {
  QueryHodApprovalsDto,
  DecideHodApprovalDto,
} from './dto/query-hod-approvals.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('hod')
export class HodApprovalsController {
  constructor(private readonly approvals: HodApprovalsService) {}

  @Get('leave-requests')
  @Roles(ROLES.HOD)
  getLeaveRequests(
    @CurrentUser() user: JwtPayload,
    @Query() query: QueryHodApprovalsDto,
  ) {
    return this.approvals.getLeaveRequests(user, query.audience, query.tab);
  }

  @Patch('leave-requests/:kind/:id')
  @Roles(ROLES.HOD)
  decideLeaveRequest(
    @CurrentUser() user: JwtPayload,
    @Param('kind') kind: 'student' | 'faculty',
    @Param('id', ParseIntPipe) id: number,
    @Body() body: DecideHodApprovalDto,
  ) {
    return this.approvals.decideLeaveRequest(user, kind, id, body.decision);
  }

  @Get('od-requests')
  @Roles(ROLES.HOD)
  getOdRequests(
    @CurrentUser() user: JwtPayload,
    @Query() query: QueryHodApprovalsDto,
  ) {
    return this.approvals.getOdRequests(user, query.audience, query.tab);
  }

  @Patch('od-requests/:kind/:id')
  @Roles(ROLES.HOD)
  decideOdRequest(
    @CurrentUser() user: JwtPayload,
    @Param('kind') kind: 'student' | 'faculty',
    @Param('id', ParseIntPipe) id: number,
    @Body() body: DecideHodApprovalDto,
  ) {
    return this.approvals.decideOdRequest(user, kind, id, body.decision);
  }
}
