import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
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
  findAllByDepartment(
    @Param('departmentId', ParseIntPipe) departmentId: number,
  ) {
    return this.service.findAllByDepartment(departmentId);
  }
}

/**
 * Faculty-facing — real-time scoped to whichever class(es) the caller is
 * currently the class_mentor (advisor) for. A non-advisor genuinely gets an
 * empty array (frontend shows the "you need to be a class advisor" gap
 * message); the moment a faculty is assigned/reassigned as advisor of a
 * different class in class_mentors, this list changes on the next fetch —
 * no caching of "which class" beyond the live class_mentors row.
 */
@Controller('me/mentee-higher-education')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.FACULTY)
export class MeMenteeHigherEducationController {
  constructor(private readonly service: StudentHigherEducationService) {}

  @Get()
  findForMentor(@CurrentUser() user: JwtPayload) {
    return this.service.findAllForMentor(user.sub);
  }
}

/** Student-facing — a student's own higher-studies record, if staff have
 * added one. Read-only, same real-time-scoped shape as MeEntrepreneurshipController. */
@Controller('me/higher-education')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.STUDENT)
export class MeHigherEducationController {
  constructor(private readonly service: StudentHigherEducationService) {}

  @Get()
  findMine(@CurrentUser() user: JwtPayload) {
    return this.service.findForStudent(user.sub);
  }
}
