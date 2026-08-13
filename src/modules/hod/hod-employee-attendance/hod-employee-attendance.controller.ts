import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { ROLES } from 'src/common/constants/roles.constant';
import { HodEmployeeAttendanceService } from './hod-employee-attendance.service';

@Controller('hod/employee/attendance')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.HOD)
export class HodEmployeeAttendanceController {
  constructor(
    private readonly hodEmployeeAttendanceService: HodEmployeeAttendanceService,
  ) {}

  /** GET /api/v1/hod/employee/attendance?academic_year= */
  @Get()
  getMyAttendance(
    @CurrentUser() user: JwtPayload,
    @Query('academic_year') academicYear?: string,
  ) {
    return this.hodEmployeeAttendanceService.getMyAttendance(
      user.sub,
      academicYear,
    );
  }
}
