import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { StudentProfilesService } from './student-profiles.service';
import { UpdateStudentProfileDto } from './dto/update-student-profile.dto';
import { CreateStudentProjectDto } from './dto/create-student-project.dto';
import { UpdateStudentProjectDto } from './dto/update-student-project.dto';
import { ListStudentProfilesQueryDto } from './dto/list-student-profiles-query.dto';
import { JwtAuthGuard } from '../../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../../auth/guards/roles.guard';
import { Roles } from '../../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../../auth/decorators/current-user.decorator';
import { ROLES } from '../../../common/constants/roles.constant';
import type { JwtPayload } from '../../../auth/interfaces/jwt-payload.interface';

/**
 * Student placement profiles (resume, LinkedIn, GitHub, LeetCode, HackerRank,
 * Codeforces) and projects — per worflow.md. Students manage their own;
 * Placement Cell and mentor Faculty can view (Admin retains oversight access).
 *
 * The `me` routes are declared before the `:studentId` route so they resolve
 * first — Nest/Express match routes in declaration order.
 */
@Controller('student-profiles')
@UseGuards(JwtAuthGuard, RolesGuard)
export class StudentProfilesController {
  constructor(
    private readonly studentProfilesService: StudentProfilesService,
  ) {}

  @Get('me')
  @Roles(ROLES.STUDENT)
  getOwnProfile(@CurrentUser() user: JwtPayload) {
    return this.studentProfilesService.getOwnProfile(user);
  }

  @Patch('me')
  @Roles(ROLES.STUDENT)
  upsertOwnProfile(
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdateStudentProfileDto,
  ) {
    return this.studentProfilesService.upsertOwnProfile(user, dto);
  }

  @Post('me/projects')
  @Roles(ROLES.STUDENT)
  addOwnProject(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateStudentProjectDto,
  ) {
    return this.studentProfilesService.addOwnProject(user, dto);
  }

  @Patch('me/projects/:projectId')
  @Roles(ROLES.STUDENT)
  updateOwnProject(
    @CurrentUser() user: JwtPayload,
    @Param('projectId', ParseIntPipe) projectId: number,
    @Body() dto: UpdateStudentProjectDto,
  ) {
    return this.studentProfilesService.updateOwnProject(user, projectId, dto);
  }

  @Delete('me/projects/:projectId')
  @Roles(ROLES.STUDENT)
  removeOwnProject(
    @CurrentUser() user: JwtPayload,
    @Param('projectId', ParseIntPipe) projectId: number,
  ) {
    return this.studentProfilesService.removeOwnProject(user, projectId);
  }

  @Get()
  @Roles(ROLES.PLACEMENT, ROLES.ADMIN)
  listProfiles(@Query() query: ListStudentProfilesQueryDto) {
    return this.studentProfilesService.listProfiles(query);
  }

  @Get(':studentId')
  @Roles(ROLES.PLACEMENT, ROLES.ADMIN, ROLES.FACULTY)
  getProfileForViewer(
    @CurrentUser() user: JwtPayload,
    @Param('studentId', ParseIntPipe) studentId: number,
  ) {
    return this.studentProfilesService.getProfileForViewer(user, studentId);
  }
}
