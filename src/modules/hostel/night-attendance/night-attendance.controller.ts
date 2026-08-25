import { Body, Controller, Get, Param, ParseIntPipe, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { ROLES } from 'src/common/constants/roles.constant';
import { PrismaService } from 'src/prisma/prisma.service';
import { resolveWardenHostelId } from '../common/warden-scope.util';
import { NightAttendanceService } from './night-attendance.service';
import { MarkAttendanceDto } from './dto/mark-attendance.dto';

@Controller('hostel/night-attendance')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.ADMIN, ROLES.GATE_WARDEN, ROLES.WARDEN)
export class NightAttendanceController {
  constructor(
    private readonly nightAttendanceService: NightAttendanceService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  async summary(@Query('date') date: string | undefined, @CurrentUser() user: JwtPayload) {
    const hostelId = await resolveWardenHostelId(this.prisma, user.sub);
    return this.nightAttendanceService.summary(hostelId, date);
  }

  @Post('resolve-all')
  async resolveAll(@Body('date') date: string | undefined, @CurrentUser() user: JwtPayload) {
    const hostelId = await resolveWardenHostelId(this.prisma, user.sub);
    return this.nightAttendanceService.resolveAll(hostelId, user.sub, date);
  }

  /** POST /hostel/night-attendance/publish — declared before ':studentId' so
   *  the literal segment is not captured by the parameterised route. */
  @Post('publish')
  async publish(@Body('date') date: string | undefined, @CurrentUser() user: JwtPayload) {
    const hostelId = await resolveWardenHostelId(this.prisma, user.sub);
    return this.nightAttendanceService.publish(hostelId, user.sub, date);
  }

  @Post(':studentId')
  async mark(
    @Param('studentId', ParseIntPipe) studentId: number,
    @Body() dto: MarkAttendanceDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const hostelId = await resolveWardenHostelId(this.prisma, user.sub);
    return this.nightAttendanceService.mark(studentId, dto, user.sub, hostelId);
  }
}
