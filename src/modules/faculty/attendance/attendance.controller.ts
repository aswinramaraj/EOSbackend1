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

@Controller('me')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AttendanceController {
  constructor(private readonly attendanceService: AttendanceService) {}

  /** POST /api/v1/attendance — Faculty / Secretary. */
  @Post('attendance')
  @Roles(ROLES.FACULTY, ROLES.SECRETARY)
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateAttendanceDto, @CurrentUser() user: JwtPayload) {
    return this.attendanceService.create(dto, user);
  }

  /** GET /api/v1/attendance — Admin/HoD/Faculty/Secretary/Student/Parent. Student/Parent are scoped to their own records. */
  @Get('attendance')
  @Roles(
    ROLES.ADMIN,
    ROLES.HOD,
    ROLES.FACULTY,
    ROLES.SECRETARY,
    ROLES.STUDENT,
    ROLES.PARENT,
  )
  findAll(
    @Query() query: ListAttendanceQueryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.attendanceService.findAll(query, user);
  }

  /** GET /api/v1/attendance/:id — Admin/HoD/Faculty/Secretary/Student/Parent. Student/Parent are scoped to their own records. */
  @Get('attendance/:id')
  @Roles(
    ROLES.ADMIN,
    ROLES.HOD,
    ROLES.FACULTY,
    ROLES.SECRETARY,
    ROLES.STUDENT,
    ROLES.PARENT,
  )
  findOne(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.attendanceService.findOne(id, user);
  }

  /** PATCH /api/v1/attendance/:id — Faculty / Secretary, and only whoever marked it. */
  @Patch('attendance/:id')
  @Roles(ROLES.FACULTY, ROLES.SECRETARY)
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateAttendanceDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.attendanceService.update(id, dto, user.sub);
  }
}
