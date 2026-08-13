import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { ROLES } from 'src/common/constants/roles.constant';
import { HodEmployeeTimetableService } from './hod-employee-timetable.service';

@Controller('hod/employee/timetable')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.HOD)
export class HodEmployeeTimetableController {
  constructor(
    private readonly hodEmployeeTimetableService: HodEmployeeTimetableService,
  ) {}

  /** GET /api/v1/hod/employee/timetable?date= */
  @Get()
  getDay(@CurrentUser() user: JwtPayload, @Query('date') date?: string) {
    return this.hodEmployeeTimetableService.getDay(user.sub, date);
  }

  /** GET /api/v1/hod/employee/timetable/week?date= */
  @Get('week')
  getWeek(@CurrentUser() user: JwtPayload, @Query('date') date?: string) {
    return this.hodEmployeeTimetableService.getWeek(user.sub, date);
  }
}
