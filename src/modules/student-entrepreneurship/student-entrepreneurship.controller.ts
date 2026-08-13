import { Controller, Get, Param, ParseIntPipe, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { ROLES } from 'src/common/constants/roles.constant';
import { StudentEntrepreneurshipService } from './student-entrepreneurship.service';

@Controller('student-entrepreneurship')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.PRINCIPAL)
export class StudentEntrepreneurshipController {
  constructor(private readonly service: StudentEntrepreneurshipService) {}

  /** GET /student-entrepreneurship — Principal only, every department at once. */
  @Get()
  findAll() {
    return this.service.findAll();
  }

  /** GET /student-entrepreneurship/department/:departmentId — Principal only, any department. */
  @Get('department/:departmentId')
  findAllByDepartment(@Param('departmentId', ParseIntPipe) departmentId: number) {
    return this.service.findAllByDepartment(departmentId);
  }
}

/** Faculty-facing — real-time scoped to the caller's own class_mentors
 * assignment(s), same live-reassignment semantics as MeMenteeHigherEducationController. */
@Controller('me/mentee-entrepreneurship')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.FACULTY)
export class MeMenteeEntrepreneurshipController {
  constructor(private readonly service: StudentEntrepreneurshipService) {}

  @Get()
  findForMentor(@CurrentUser() user: JwtPayload) {
    return this.service.findAllForMentor(user.sub);
  }
}
