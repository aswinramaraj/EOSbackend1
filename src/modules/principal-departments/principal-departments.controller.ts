import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { ROLES } from 'src/common/constants/roles.constant';
import { PrincipalDepartmentsService } from './principal-departments.service';

@Controller('principal-departments')
@UseGuards(JwtAuthGuard, RolesGuard)
// Secretary added — same institution-wide posture as principal-students/
// principal-faculty/principal-exams/principal-placements (no
// secretary→department table exists anywhere in the schema).
@Roles(ROLES.PRINCIPAL, ROLES.SECRETARY)
export class PrincipalDepartmentsController {
  constructor(private readonly service: PrincipalDepartmentsService) {}

  /** GET /principal-departments/overview — per-department strength, HoD, attendance and placement outcomes. */
  @Get('overview')
  getOverview() {
    return this.service.getOverview();
  }

  /** GET /principal-departments/class-mentors?department_id= — real per-section mentor directory. */
  @Get('class-mentors')
  getClassMentors(@Query('department_id') departmentId?: string) {
    return this.service.getClassMentors(departmentId ? Number(departmentId) : undefined);
  }

  /** GET /principal-departments/nba-status?department_id= — real NBA readiness aggregate. */
  @Get('nba-status')
  getNbaStatus(@Query('department_id') departmentId?: string) {
    return this.service.getNbaStatus(departmentId ? Number(departmentId) : undefined);
  }

  /** GET /principal-departments/class-strength?department_id= — real per-section strength + attendance. */
  @Get('class-strength')
  getClassStrength(@Query('department_id') departmentId?: string) {
    return this.service.getClassStrength(departmentId ? Number(departmentId) : undefined);
  }
}
