import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { ROLES } from 'src/common/constants/roles.constant';
import { HodClassRecordsService } from './hod-class-records.service';
import { HodFacultyStaffService } from './hod-faculty-staff.service';
import { HodExaminationsService } from './hod-examinations.service';
import { HodStudentProfileService } from './hod-student-profile.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('hod')
export class HodDepartmentController {
  constructor(
    private readonly classRecords: HodClassRecordsService,
    private readonly facultyStaff: HodFacultyStaffService,
    private readonly examinations: HodExaminationsService,
    private readonly studentProfile: HodStudentProfileService,
  ) {}

  @Get('class-records/classes')
  @Roles(ROLES.HOD)
  getClasses(@CurrentUser() user: JwtPayload) {
    return this.classRecords.getClasses(user);
  }

  @Get('class-records/student/:id/meeting-notes')
  @Roles(ROLES.HOD)
  getMeetingNotes(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.studentProfile.getMeetingNotes(user, id);
  }

  @Post('class-records/student/:id/meeting-notes')
  @Roles(ROLES.HOD)
  addMeetingNote(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { meeting_date: string; note: string },
  ) {
    return this.studentProfile.addMeetingNote(user, id, body);
  }

  @Get('class-records/student/:id')
  @Roles(ROLES.HOD)
  getStudentProfile(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.studentProfile.getProfile(user, id);
  }

  @Get('class-records/:classId')
  @Roles(ROLES.HOD)
  getClassDetail(
    @CurrentUser() user: JwtPayload,
    @Param('classId', ParseIntPipe) classId: number,
  ) {
    return this.classRecords.getClassDetail(user, classId);
  }

  @Get('faculty-staff/overview')
  @Roles(ROLES.HOD)
  getFacultyStaffOverview(@CurrentUser() user: JwtPayload) {
    return this.facultyStaff.getOverview(user);
  }

  @Get('faculty-staff/list')
  @Roles(ROLES.HOD)
  getFacultyStaffList(
    @CurrentUser() user: JwtPayload,
    @Query('type') type: 'all' | 'teaching' | 'non_teaching' = 'all',
    @Query('search') search?: string,
    @Query('designation') designation?: string,
  ) {
    return this.facultyStaff.getList(user, type, search, designation);
  }

  @Get('faculty-staff/faculty/:id')
  @Roles(ROLES.HOD)
  getFacultyProfile(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.facultyStaff.getFacultyProfile(user, id);
  }

  @Get('faculty-staff/non-teaching/:id')
  @Roles(ROLES.HOD)
  getNonTeachingProfile(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.facultyStaff.getNonTeachingProfile(user, id);
  }

  @Get('examinations/filters')
  @Roles(ROLES.HOD)
  getExaminationFilters(@CurrentUser() user: JwtPayload) {
    return this.examinations.getFilters(user);
  }

  @Get('examinations/grid')
  @Roles(ROLES.HOD)
  getExaminationGrid(
    @CurrentUser() user: JwtPayload,
    @Query('class_id', ParseIntPipe) classId: number,
    @Query('exam_type_id', ParseIntPipe) examTypeId: number,
  ) {
    return this.examinations.getGrid(user, classId, examTypeId);
  }
}
