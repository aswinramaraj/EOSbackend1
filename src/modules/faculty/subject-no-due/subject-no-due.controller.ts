import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { ROLES } from 'src/common/constants/roles.constant';
import { SubjectNoDueService } from './subject-no-due.service';

/**
 * Faculty-facing "No Due" — Internal 1 / Internal 2 / Project / Assignment /
 * Quiz sign-off, one screen per subject this faculty handles (class advisors
 * included — advisor is just a faculty who also mentors a class, not a
 * separate role, so this reuses ROLES.FACULTY same as every other faculty
 * screen). A faculty handling more than one subject picks which one via
 * `mapping_id`, resolved from GET mappings.
 */
@Controller('me/subject-no-due')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.FACULTY)
export class SubjectNoDueController {
  constructor(private readonly subjectNoDue: SubjectNoDueService) {}

  /** GET /api/v1/me/subject-no-due/mappings */
  @Get('mappings')
  getMappings(@CurrentUser() user: JwtPayload) {
    return this.subjectNoDue.getMappings(user.sub);
  }

  /** GET /api/v1/me/subject-no-due/students?mapping_id= */
  @Get('students')
  getStudents(
    @CurrentUser() user: JwtPayload,
    @Query('mapping_id', ParseIntPipe) mappingId: number,
  ) {
    return this.subjectNoDue.getStudents(user.sub, mappingId);
  }

  /** PATCH /api/v1/me/subject-no-due/students/:studentId?mapping_id= */
  @Patch('students/:studentId')
  updateStudent(
    @CurrentUser() user: JwtPayload,
    @Param('studentId', ParseIntPipe) studentId: number,
    @Query('mapping_id', ParseIntPipe) mappingId: number,
    @Body()
    body: {
      internal1_cleared?: boolean;
      internal2_cleared?: boolean;
      project_cleared?: boolean;
      assignment_cleared?: boolean;
      quiz_cleared?: boolean;
    },
  ) {
    return this.subjectNoDue.updateStudent(
      user.sub,
      mappingId,
      studentId,
      body,
    );
  }
}
