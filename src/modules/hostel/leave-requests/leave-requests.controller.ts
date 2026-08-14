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
import { LeaveRequestsService } from './leave-requests.service';
import { SearchLeaveRequestsDto } from './dto/search-leave-requests.dto';
import { DecideLeaveRequestDto } from './dto/decide-leave-request.dto';

@Controller('hostel/leave-requests')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.ADMIN, ROLES.GATE_WARDEN)
export class LeaveRequestsController {
  constructor(private readonly leaveRequestsService: LeaveRequestsService) {}

  @Get()
  findAll(@Query() query: SearchLeaveRequestsDto) {
    return this.leaveRequestsService.findAll(query);
  }

  /** Read-only visibility into academic leaves flagged "also on hostel leave" — declared before ':id/decision' so it isn't swallowed by that param route. */
  @Get('from-academic-leave')
  findFromAcademicLeave(@Query() query: SearchLeaveRequestsDto) {
    return this.leaveRequestsService.findFromAcademicLeave(query);
  }

  @Patch(':id/decision')
  decide(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: DecideLeaveRequestDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.leaveRequestsService.decide(id, dto, user.sub);
  }
}
