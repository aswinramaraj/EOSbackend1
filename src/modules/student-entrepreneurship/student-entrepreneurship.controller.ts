import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { ROLES } from 'src/common/constants/roles.constant';
import { StudentEntrepreneurshipService } from './student-entrepreneurship.service';
import { SearchStudentsQueryDto } from './dto/search-students-query.dto';
import { CreateStudentEntrepreneurshipDto } from './dto/create-student-entrepreneurship.dto';
import { UpdateStudentEntrepreneurshipDto } from './dto/update-student-entrepreneurship.dto';

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

/** EDC-Coordinator-facing — institution-wide, every row, real-time (no caching
 * of the row set at all — resolved fresh on every request). Backs the EDC
 * Portal's "EDC Students" and "Startups" screens (same underlying rows —
 * Startups is a filtered client-side view, there is no separate ventures
 * table anywhere in the schema). */
@Controller('me/edc-entrepreneurship')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.EDC_COORDINATOR)
export class MeEdcEntrepreneurshipController {
  constructor(private readonly service: StudentEntrepreneurshipService) {}

  @Get()
  findForCoordinator() {
    return this.service.findAllForCoordinator();
  }

  /**
   * GET /me/edc-entrepreneurship/search-students?q= — the "Add Student"
   * screen's search step. Declared before no other dynamic route exists on
   * this controller, so no path-shadowing risk.
   */
  @Get('search-students')
  searchStudents(@Query() query: SearchStudentsQueryDto) {
    return this.service.searchStudentsForCoordinator(query.q, query.limit);
  }

  /** POST /me/edc-entrepreneurship — the "Add Student" screen's create step. */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateStudentEntrepreneurshipDto) {
    return this.service.createForCoordinator(dto);
  }

  /** PATCH /me/edc-entrepreneurship/:id — mentor assignment + funding edit
   * (Venture detail / Mentors / Funding screens). Real time: every screen
   * reading the same GET above updates the moment this succeeds. */
  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateStudentEntrepreneurshipDto) {
    return this.service.updateForCoordinator(id, dto);
  }

  /** DELETE /me/edc-entrepreneurship/:id — removes the venture (and cascades
   * its incubation record/milestones, unlinks any converted startup idea). */
  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.service.removeForCoordinator(id);
  }
}
