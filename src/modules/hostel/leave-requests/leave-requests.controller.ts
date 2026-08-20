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
import { PrismaService } from 'src/prisma/prisma.service';
import { resolveWardenHostelId } from '../common/warden-scope.util';
import { LeaveRequestsService } from './leave-requests.service';
import { SearchLeaveRequestsDto } from './dto/search-leave-requests.dto';
import { DecideLeaveRequestDto } from './dto/decide-leave-request.dto';

@Controller('hostel/leave-requests')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.ADMIN, ROLES.GATE_WARDEN, ROLES.WARDEN)
export class LeaveRequestsController {
  constructor(
    private readonly leaveRequestsService: LeaveRequestsService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  async findAll(
    @Query() query: SearchLeaveRequestsDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const wardenHostelId = await resolveWardenHostelId(this.prisma, user.sub);
    if (wardenHostelId != null) query.hostel_id = wardenHostelId;
    return this.leaveRequestsService.findAll(query);
  }

  /** Read-only visibility into academic leaves flagged "also on hostel leave" — declared before ':id/decision' so it isn't swallowed by that param route. */
  @Get('from-academic-leave')
  async findFromAcademicLeave(
    @Query() query: SearchLeaveRequestsDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const wardenHostelId = await resolveWardenHostelId(this.prisma, user.sub);
    if (wardenHostelId != null) query.hostel_id = wardenHostelId;
    return this.leaveRequestsService.findFromAcademicLeave(query);
  }

  @Patch(':id/decision')
  async decide(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: DecideLeaveRequestDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const wardenHostelId = await resolveWardenHostelId(this.prisma, user.sub);
    return this.leaveRequestsService.decide(id, dto, user.sub, wardenHostelId);
  }
}
