import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { ROLES } from 'src/common/constants/roles.constant';
import { LeaveTypesService } from './leave-types.service';

/** Read-only reference list — same population reachable by Requests/Vacation
 * Management (HR) and self-service leave application (Faculty). */
@Controller('leave-types')
@UseGuards(JwtAuthGuard, RolesGuard)
export class LeaveTypesController {
  constructor(private readonly leaveTypesService: LeaveTypesService) {}

  @Get()
  @Roles(ROLES.ADMIN, ROLES.HOD, ROLES.HR_PAYROLL, ROLES.FACULTY)
  findAll() {
    return this.leaveTypesService.findAll();
  }
}
