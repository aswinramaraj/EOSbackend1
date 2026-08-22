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
import { ROLES } from 'src/common/constants/roles.constant';
import { AcademicCoordinatorAttendanceService } from './academic-coordinator-attendance.service';

/** GET /api/v1/me/coordinator/attendance/* — Academic Coordinator only, read-only, any class institution-wide. */
@Controller('me/coordinator/attendance')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.ACADEMIC_COORDINATOR)
export class AcademicCoordinatorAttendanceController {
  constructor(
    private readonly attendanceService: AcademicCoordinatorAttendanceService,
  ) {}

  @Get('classes/:classId')
  classAttendance(@Param('classId', ParseIntPipe) classId: number) {
    return this.attendanceService.classAttendance(classId);
  }
}
