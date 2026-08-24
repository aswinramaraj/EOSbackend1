import {
  Body,
  Controller,
  Get,
  Patch,
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
import { HodMyClassService } from './hod-my-class.service';
import { MarkHodMyClassAttendanceDto } from './dto/mark-hod-my-class-attendance.dto';
import { MarkHodAssignmentStatusDto } from './dto/mark-hod-assignment-status.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('hod/my-class')
export class HodMyClassController {
  constructor(private readonly hodMyClass: HodMyClassService) {}

  @Get('attendance')
  @Roles(ROLES.HOD)
  getAttendance(
    @CurrentUser() user: JwtPayload,
    @Query('class_id') classId?: string,
    @Query('subject_id') subjectId?: string,
  ) {
    return this.hodMyClass.getAttendanceOverview(
      user,
      classId != null ? Number(classId) : undefined,
      subjectId != null ? Number(subjectId) : undefined,
    );
  }

  @Post('attendance/mark')
  @Roles(ROLES.HOD)
  markAttendance(
    @CurrentUser() user: JwtPayload,
    @Body() dto: MarkHodMyClassAttendanceDto,
  ) {
    return this.hodMyClass.markAttendance(user, dto);
  }

  @Get('current-semester')
  @Roles(ROLES.HOD)
  getCurrentSemester(@CurrentUser() user: JwtPayload) {
    return this.hodMyClass.getCurrentSemester(user);
  }

  @Get('subject-records')
  @Roles(ROLES.HOD)
  getSubjectRecords(
    @CurrentUser() user: JwtPayload,
    @Query('class_id') classId?: string,
    @Query('subject_id') subjectId?: string,
    @Query('semester') semester?: string,
  ) {
    return this.hodMyClass.getSubjectRecords(
      user,
      classId != null ? Number(classId) : undefined,
      subjectId != null ? Number(subjectId) : undefined,
      semester != null ? Number(semester) : undefined,
    );
  }

  @Get('assignment-status')
  @Roles(ROLES.HOD)
  getAssignmentStatus(
    @CurrentUser() user: JwtPayload,
    @Query('class_id') classId?: string,
    @Query('subject_id') subjectId?: string,
    @Query('assignment_id') assignmentId?: string,
  ) {
    return this.hodMyClass.getAssignmentStatus(
      user,
      classId != null ? Number(classId) : undefined,
      subjectId != null ? Number(subjectId) : undefined,
      assignmentId != null ? Number(assignmentId) : undefined,
    );
  }

  @Patch('assignment-status/mark')
  @Roles(ROLES.HOD)
  markAssignmentStatus(
    @CurrentUser() user: JwtPayload,
    @Body() dto: MarkHodAssignmentStatusDto,
  ) {
    return this.hodMyClass.markAssignmentStatus(user, dto);
  }
}
