import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { ROLES } from 'src/common/constants/roles.constant';
import { PrincipalDepartmentsService } from './principal-departments.service';

@Controller('principal-departments')
@UseGuards(JwtAuthGuard, RolesGuard)
// Secretary added — forced to her own department (via
// non_teaching_staff.department_id) inside the service, same pattern as
// HOD; Principal/Admin stay institution-wide.
@Roles(ROLES.PRINCIPAL, ROLES.SECRETARY)
export class PrincipalDepartmentsController {
  constructor(private readonly service: PrincipalDepartmentsService) {}

  /** GET /principal-departments/overview — per-department strength, HoD, attendance and placement outcomes. */
  @Get('overview')
  getOverview(@CurrentUser() user: JwtPayload) {
    return this.service.getOverview(user);
  }

  /** GET /principal-departments/class-mentors?department_id= — real per-section mentor directory. */
  @Get('class-mentors')
  getClassMentors(@CurrentUser() user: JwtPayload, @Query('department_id') departmentId?: string) {
    return this.service.getClassMentors(user, departmentId ? Number(departmentId) : undefined);
  }

  /** GET /principal-departments/nba-status?department_id= — real NBA readiness aggregate. */
  @Get('nba-status')
  getNbaStatus(@CurrentUser() user: JwtPayload, @Query('department_id') departmentId?: string) {
    return this.service.getNbaStatus(user, departmentId ? Number(departmentId) : undefined);
  }

  /** GET /principal-departments/class-strength?department_id= — real per-section strength + attendance. */
  @Get('class-strength')
  getClassStrength(@CurrentUser() user: JwtPayload, @Query('department_id') departmentId?: string) {
    return this.service.getClassStrength(user, departmentId ? Number(departmentId) : undefined);
  }
}
