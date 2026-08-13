import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { ROLES } from 'src/common/constants/roles.constant';
import { HodMyClassAttendanceService } from './hod-my-class-attendance.service';
import { MarkHodClassAttendanceDto } from './dto/mark-hod-class-attendance.dto';

@Controller('hod/my-class/attendance')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.HOD)
export class HodMyClassAttendanceController {
  constructor(
    private readonly hodMyClassAttendanceService: HodMyClassAttendanceService,
  ) {}

  /** GET /api/v1/hod/my-class/attendance?class_id=&subject_id= */
  @Get()
  getOverview(
    @CurrentUser() user: JwtPayload,
    @Query('class_id') classId?: string,
    @Query('subject_id') subjectId?: string,
  ) {
    return this.hodMyClassAttendanceService.getOverview(
      user.sub,
      classId ? Number(classId) : undefined,
      subjectId ? Number(subjectId) : undefined,
    );
  }

  /** POST /api/v1/hod/my-class/attendance/mark */
  @Post('mark')
  mark(
    @CurrentUser() user: JwtPayload,
    @Body() dto: MarkHodClassAttendanceDto,
  ) {
    return this.hodMyClassAttendanceService.mark(
      user.sub,
      dto.class_id,
      dto.subject_id,
      dto.records,
    );
  }
}
