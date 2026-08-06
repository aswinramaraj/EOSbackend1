import {
  Body,
  Controller,
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
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { ROLES } from 'src/common/constants/roles.constant';
import { AttendanceService } from './attendance.service';
import { CreateAttendanceDto } from './dto/create-attendance.dto';
import { UpdateAttendanceDto } from './dto/update-attendance.dto';
import { ListAttendanceQueryDto } from './dto/list-attendance-query.dto';
import { MeStaffAttendanceService } from './me-staff-attendance.service';
import { GetStaffAttendanceDto } from './dto/get-staff-attendance.dto';

@Controller('me')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AttendanceController {
  constructor(
    private readonly attendanceService: AttendanceService,
    private readonly meStaffAttendanceService: MeStaffAttendanceService,
  ) {}

  /** POST /api/v1/attendance — Faculty only. */
  @Post('attendance')
  @Roles(ROLES.FACULTY)
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateAttendanceDto, @CurrentUser() user: JwtPayload) {
    return this.attendanceService.create(dto, user.sub);
  }

  /** GET /api/v1/attendance — Admin/HoD/Faculty/Student/Parent. Student/Parent are scoped to their own records. */
  @Get('attendance')
  @Roles(ROLES.ADMIN, ROLES.HOD, ROLES.FACULTY, ROLES.STUDENT, ROLES.PARENT)
  findAll(
    @Query() query: ListAttendanceQueryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.attendanceService.findAll(query, user);
  }

  /** GET /api/v1/attendance/:id — Admin/HoD/Faculty/Student/Parent. Student/Parent are scoped to their own records. */
  @Get('attendance/:id')
  @Roles(ROLES.ADMIN, ROLES.HOD, ROLES.FACULTY, ROLES.STUDENT, ROLES.PARENT)
  findOne(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.attendanceService.findOne(id, user);
  }

  /** PATCH /api/v1/attendance/:id — Faculty only, and only the faculty who marked it. */
  @Patch('attendance/:id')
  @Roles(ROLES.FACULTY)
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateAttendanceDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.attendanceService.update(id, dto, user.sub);
  }

  /**
   * GET /api/v1/me/staff-attendance?year=&month= — Faculty only.
   * Self-scoped, best-effort staff attendance derived from approved leaves
   * and holiday-slot opt-ins (see MeStaffAttendanceService for details).
   */
  @Get('staff-attendance')
  @Roles(ROLES.FACULTY)
  getStaffAttendance(
    @Query() query: GetStaffAttendanceDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.meStaffAttendanceService.getMyStaffAttendance(
      user.sub,
      query,
    );
  }
}
