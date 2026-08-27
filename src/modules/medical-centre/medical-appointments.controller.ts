import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
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
import { ROLES, type RoleKey } from 'src/common/constants/roles.constant';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { MedicalAppointmentsService } from './medical-appointments.service';
import {
  AvailabilityRangeQueryDto,
  CreateAppointmentDto,
} from './dto/appointment.dto';

/**
 * Every role that may book a medical appointment: everyone the ERP has except
 * PARENT, who is deliberately excluded — a parent is not on campus and the
 * mobile app does not show them the Medical tile either.
 *
 * Listed explicitly rather than relying on "no @Roles() means any authenticated
 * user", because that default would silently include PARENT and any role added
 * to the system later. Adding a role to this array is a visible, reviewable
 * decision.
 */
const BOOKING_ROLES: RoleKey[] = [
  ROLES.STUDENT,
  ROLES.FACULTY,
  ROLES.HOD,
  ROLES.HR_PAYROLL,
  ROLES.SECRETARY,
  ROLES.WARDEN,
  ROLES.GATE_WARDEN,
  ROLES.PRINCIPAL,
  ROLES.ADMIN,
  ROLES.COE,
  ROLES.IQAC,
  ROLES.PLACEMENT,
  ROLES.LIBRARY,
  ROLES.BILLING,
  ROLES.FINANCE,
  ROLES.MEDIA_ROOM,
  ROLES.ACADEMIC_COORDINATOR,
  ROLES.NON_TEACHING_STAFF,
  ROLES.TRANSPORT,
  ROLES.HIGHER_EDUCATION,
  ROLES.MEDICAL_CENTRE,
  ROLES.SPORTS_ADMIN,
  ROLES.EDC_COORDINATOR,
  ROLES.ALUMNI,
];

/**
 * Medical centre appointments — the booking side, used by the mobile app.
 *
 * Separate controller from the staff one (medical-centre-appointments.controller.ts)
 * on purpose: these two have very different role lists, and keeping them apart
 * means widening access here can never widen the approval endpoints.
 *
 * Every route derives the acting user from the JWT. Nothing accepts a user id.
 */
@Controller('me/medical-appointments')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(...BOOKING_ROLES)
export class MedicalAppointmentsController {
  constructor(private readonly service: MedicalAppointmentsService) {}

  /**
   * GET /api/v1/me/medical-appointments/availability?from=&to=
   *
   * Declared before the parameterised route below so the literal "availability"
   * segment is matched first.
   */
  @Get('availability')
  getAvailability(@Query() query: AvailabilityRangeQueryDto) {
    return this.service.getAvailability(query.from, query.to);
  }

  /** GET /api/v1/me/medical-appointments/mine — this user's own bookings. */
  @Get('mine')
  listMine(@CurrentUser() user: JwtPayload) {
    return this.service.listMine(user.sub);
  }

  /** GET /api/v1/me/medical-appointments/availability/:date — the slots on one date. */
  @Get('availability/:date')
  getDay(@Param('date') date: string, @CurrentUser() user: JwtPayload) {
    return this.service.getDay(user.sub, date);
  }

  /** POST /api/v1/me/medical-appointments — book a slot. Lands as pending; does not enter the OPD queue. */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  book(@Body() dto: CreateAppointmentDto, @CurrentUser() user: JwtPayload) {
    return this.service.book(user.sub, dto);
  }

  /** DELETE /api/v1/me/medical-appointments/:id — withdraw one's own still-pending booking. */
  @Delete(':id')
  cancel(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.cancel(user.sub, id);
  }
}
