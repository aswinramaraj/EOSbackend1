import { Controller, Get, Param, ParseIntPipe, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { ROLES } from 'src/common/constants/roles.constant';
import { StudentHigherEducationService } from './student-higher-education.service';

@Controller('student-higher-education')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.PRINCIPAL)
export class StudentHigherEducationController {
  constructor(private readonly service: StudentHigherEducationService) {}

  /** GET /student-higher-education — Principal only, every department at once. */
  @Get()
  findAll() {
    return this.service.findAll();
  }

  /** GET /student-higher-education/department/:departmentId — Principal only, any department. */
  @Get('department/:departmentId')
  findAllByDepartment(@Param('departmentId', ParseIntPipe) departmentId: number) {
    return this.service.findAllByDepartment(departmentId);
  }
}
