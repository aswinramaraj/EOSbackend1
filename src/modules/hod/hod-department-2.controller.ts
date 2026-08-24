import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Put,
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
import { HodPlacementsService } from './hod-placements.service';
import { HodHigherEducationService } from './hod-higher-education.service';
import { HodEdcService } from './hod-edc.service';
import { HodAssignFacultyService } from './hod-assign-faculty.service';
import { HodTimetableService } from './hod-timetable.service';
import { HodAcademicCalendarService } from './hod-academic-calendar.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('hod')
export class HodDepartment2Controller {
  constructor(
    private readonly placements: HodPlacementsService,
    private readonly higherEducation: HodHigherEducationService,
    private readonly edc: HodEdcService,
    private readonly assignFaculty: HodAssignFacultyService,
    private readonly timetable: HodTimetableService,
    private readonly academicCalendar: HodAcademicCalendarService,
  ) {}

  @Get('placements/drives')
  @Roles(ROLES.HOD)
  getPlacementDrives() {
    return this.placements.getDrives();
  }

  @Get('placements/students')
  @Roles(ROLES.HOD)
  getPlacementStudents(
    @CurrentUser() user: JwtPayload,
    @Query('search') search?: string,
    @Query('class_id') classId?: string,
  ) {
    return this.placements.getStudents(
      user,
      search,
      classId ? Number(classId) : undefined,
    );
  }

  @Get('placements/history')
  @Roles(ROLES.HOD)
  getPlacementHistory(@CurrentUser() user: JwtPayload) {
    return this.placements.getHistory(user);
  }

  @Get('higher-education')
  @Roles(ROLES.HOD)
  getHigherEducation(
    @CurrentUser() user: JwtPayload,
    @Query('search') search?: string,
    @Query('batch_id') batchId?: string,
    @Query('programme') programme?: string,
  ) {
    return this.higherEducation.getOverview(
      user,
      search,
      batchId ? Number(batchId) : undefined,
      programme,
    );
  }

  @Get('higher-education/:id')
  @Roles(ROLES.HOD)
  getHigherEducationProfile(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.higherEducation.getProfile(user, id);
  }

  @Get('edc')
  @Roles(ROLES.HOD)
  getEdc(
    @CurrentUser() user: JwtPayload,
    @Query('search') search?: string,
    @Query('batch_id') batchId?: string,
    @Query('department_id') departmentId?: string,
  ) {
    return this.edc.getOverview(
      user,
      search,
      batchId ? Number(batchId) : undefined,
      departmentId ? Number(departmentId) : undefined,
    );
  }

  @Get('edc/:id')
  @Roles(ROLES.HOD)
  getEdcProfile(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.edc.getProfile(user, id);
  }

  @Get('assign-faculty')
  @Roles(ROLES.HOD)
  getAssignFaculty(
    @CurrentUser() user: JwtPayload,
    @Query('class_id') classId?: string,
  ) {
    return this.assignFaculty.getOverview(
      user,
      classId ? Number(classId) : undefined,
    );
  }

  @Patch('assign-faculty/handling-faculty')
  @Roles(ROLES.HOD)
  setHandlingFaculty(
    @CurrentUser() user: JwtPayload,
    @Body()
    body: { class_id: number; subject_id: number; faculty_id: number },
  ) {
    return this.assignFaculty.setHandlingFaculty(
      user,
      body.class_id,
      body.subject_id,
      body.faculty_id,
    );
  }

  @Patch('assign-faculty/substitute-faculty')
  @Roles(ROLES.HOD)
  setSubstituteFaculty(
    @CurrentUser() user: JwtPayload,
    @Body()
    body: {
      class_id: number;
      subject_id: number;
      faculty_id: number | null;
    },
  ) {
    return this.assignFaculty.setSubstituteFaculty(
      user,
      body.class_id,
      body.subject_id,
      body.faculty_id,
    );
  }

  @Get('timetable')
  @Roles(ROLES.HOD)
  getTimetable(
    @CurrentUser() user: JwtPayload,
    @Query('class_id') classId?: string,
  ) {
    return this.timetable.getOverview(
      user,
      classId ? Number(classId) : undefined,
    );
  }

  @Put('timetable/slot')
  @Roles(ROLES.HOD)
  setTimetableSlot(
    @CurrentUser() user: JwtPayload,
    @Body()
    body: {
      class_id: number;
      day_of_week: number;
      period_number: number;
      subject_id: number;
      faculty_id: number;
    },
  ) {
    return this.timetable.setSlot(
      user,
      body.class_id,
      body.day_of_week,
      body.period_number,
      body.subject_id,
      body.faculty_id,
    );
  }

  @Delete('timetable/slot/:id')
  @Roles(ROLES.HOD)
  clearTimetableSlot(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.timetable.clearSlot(user, id);
  }

  @Get('academic-calendar')
  @Roles(ROLES.HOD)
  getAcademicCalendar(
    @Query('year', ParseIntPipe) year: number,
    @Query('month', ParseIntPipe) month: number,
  ) {
    return this.academicCalendar.getMonth(year, month);
  }
}
