import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import { ROLES } from 'src/common/constants/roles.constant';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { HigherEducationStudentListsService } from './higher-education-student-lists.service';
import {
  AddApplicationStudentDto,
  AddTestStudentDto,
  SearchStudentsQueryDto,
  UpdateApplicationStudentDto,
  UpdateTestStudentDto,
} from './dto/application-students.dto';

/**
 * The student lists behind an application window and behind a test.
 *
 * Test routes are keyed by `testName` because higher_education_test_register is
 * keyed by its name rather than by a surrogate id.
 */
@Controller('me')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.HIGHER_EDUCATION, ROLES.ADMIN)
export class HigherEducationStudentListsController {
  constructor(
    private readonly service: HigherEducationStudentListsService,
  ) {}

  /** GET /api/v1/me/higher-education-student-search?q= — picker for both flows. */
  @Get('higher-education-student-search')
  searchStudents(@Query() query: SearchStudentsQueryDto) {
    return this.service.searchStudents(query.q);
  }

  // ─────────────────────── application window students ───────────────────────

  /** GET /api/v1/me/higher-education-application-windows/:id/students */
  @Get('higher-education-application-windows/:id/students')
  listApplicationStudents(@Param('id', ParseIntPipe) id: number) {
    return this.service.listApplicationStudents(id);
  }

  /** POST /api/v1/me/higher-education-application-windows/:id/students */
  @Post('higher-education-application-windows/:id/students')
  @HttpCode(HttpStatus.CREATED)
  addApplicationStudent(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AddApplicationStudentDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.addApplicationStudent(id, dto, user.sub);
  }

  /** PATCH /api/v1/me/higher-education-application-students/:id */
  @Patch('higher-education-application-students/:id')
  updateApplicationStudent(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateApplicationStudentDto,
  ) {
    return this.service.updateApplicationStudent(id, dto);
  }

  /** DELETE /api/v1/me/higher-education-application-students/:id */
  @Delete('higher-education-application-students/:id')
  removeApplicationStudent(@Param('id', ParseIntPipe) id: number) {
    return this.service.removeApplicationStudent(id);
  }

  // ───────────────────────────── test students ─────────────────────────────

  /** GET /api/v1/me/higher-education-test-register/:testName/students */
  @Get('higher-education-test-register/:testName/students')
  listTestStudents(@Param('testName') testName: string) {
    return this.service.listTestStudents(testName);
  }

  /** POST /api/v1/me/higher-education-test-register/:testName/students */
  @Post('higher-education-test-register/:testName/students')
  @HttpCode(HttpStatus.CREATED)
  addTestStudent(
    @Param('testName') testName: string,
    @Body() dto: AddTestStudentDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.addTestStudent(testName, dto, user.sub);
  }

  /** PATCH /api/v1/me/higher-education-test-students/:id */
  @Patch('higher-education-test-students/:id')
  updateTestStudent(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateTestStudentDto,
  ) {
    return this.service.updateTestStudent(id, dto);
  }

  /** DELETE /api/v1/me/higher-education-test-students/:id */
  @Delete('higher-education-test-students/:id')
  removeTestStudent(@Param('id', ParseIntPipe) id: number) {
    return this.service.removeTestStudent(id);
  }
}
