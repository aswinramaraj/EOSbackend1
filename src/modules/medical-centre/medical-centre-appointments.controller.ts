import {
  Body,
  Controller,
  Delete,
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
import { ROLES } from 'src/common/constants/roles.constant';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { MedicalCentreAppointmentsService } from './medical-centre-appointments.service';
import {
  AppointmentDecisionDto,
  CreateAppointmentWindowDto,
  DayQueryDto,
  SlotBookingsQueryDto,
  UpdateAppointmentWindowDto,
  WindowRangeQueryDto,
} from './dto/appointment.dto';

/**
 * Medical centre appointments — staff side.
 *
 * Every route here is medical-centre-only. The booking side that students and
 * staff use lives on a separate controller with its own, much wider role list
 * (see medical-appointments.controller.ts) so widening one can never
 * accidentally widen the other.
 *
 * Route order matters in Nest: every path below starts with a literal segment
 * ("windows", "slots", "bookings"), so no parameterised route can swallow one.
 */
@Controller('me/medical-centre-appointments')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.MEDICAL_CENTRE)
export class MedicalCentreAppointmentsController {
  constructor(private readonly service: MedicalCentreAppointmentsService) {}

  /** GET /api/v1/me/medical-centre-appointments/windows?from=&to= — time parts in a date range. */
  @Get('windows')
  listWindows(@Query() query: WindowRangeQueryDto) {
    return this.service.listWindows(query.from, query.to);
  }

  /** POST /api/v1/me/medical-centre-appointments/windows — open a time part on a date. */
  @Post('windows')
  @HttpCode(HttpStatus.CREATED)
  createWindow(
    @Body() dto: CreateAppointmentWindowDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.createWindow(dto, user.sub);
  }

  /** PATCH /api/v1/me/medical-centre-appointments/windows/:id */
  @Patch('windows/:id')
  updateWindow(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateAppointmentWindowDto,
  ) {
    return this.service.updateWindow(id, dto);
  }

  /** DELETE /api/v1/me/medical-centre-appointments/windows/:id — refused while live bookings exist. */
  @Delete('windows/:id')
  deleteWindow(@Param('id', ParseIntPipe) id: number) {
    return this.service.deleteWindow(id);
  }

  /** GET /api/v1/me/medical-centre-appointments/slots?date= — the day's time parts with their derived slots and counts. */
  @Get('slots')
  getDay(@Query() query: DayQueryDto) {
    return this.service.getDay(query.date);
  }

  /** GET /api/v1/me/medical-centre-appointments/bookings?date=&start= — who booked one slot. */
  @Get('bookings')
  listSlotBookings(@Query() query: SlotBookingsQueryDto) {
    return this.service.listSlotBookings(query.date, query.start);
  }

  /** POST /api/v1/me/medical-centre-appointments/bookings/:id/approve — the only route that puts a booking in the OPD queue. */
  @Post('bookings/:id/approve')
  approve(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AppointmentDecisionDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.approve(id, user.sub, dto.note);
  }

  /** POST /api/v1/me/medical-centre-appointments/bookings/:id/reject */
  @Post('bookings/:id/reject')
  reject(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AppointmentDecisionDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.reject(id, user.sub, dto.note);
  }
}
