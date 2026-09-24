import { Body, Controller, Get, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import { ROLES } from 'src/common/constants/roles.constant';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { StationaryService } from './stationary.service';
import { CreateStationaryOrderDto } from './dto/create-stationary-order.dto';
import { VerifyStationaryPaymentDto } from './dto/verify-stationary-payment.dto';

// Stationary/print-shop request - reachable from the Amenity tab's
// "Stationary" tile for every role that has one (every real backend role
// except Parent, matching this project's other student-life amenities -
// see StationaryScreen.tsx on the mobile side).
const STATIONARY_ROLES = [
  ROLES.ADMIN,
  ROLES.PRINCIPAL,
  ROLES.HOD,
  ROLES.FACULTY,
  ROLES.STUDENT,
  ROLES.COE,
  ROLES.PLACEMENT,
  ROLES.LIBRARY,
  ROLES.BILLING,
  ROLES.HR_PAYROLL,
  ROLES.FINANCE,
  ROLES.IQAC,
  ROLES.SECRETARY,
  ROLES.GATE_WARDEN,
  ROLES.WARDEN,
  ROLES.MEDIA_ROOM,
  ROLES.ACADEMIC_COORDINATOR,
  ROLES.ALUMNI,
  ROLES.NON_TEACHING_STAFF,
  ROLES.TRANSPORT,
  ROLES.HIGHER_EDUCATION,
  ROLES.MEDICAL_CENTRE,
  ROLES.SPORTS_ADMIN,
  ROLES.EDC_COORDINATOR,
] as const;

@Controller('me/stationary-requests')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(...STATIONARY_ROLES)
export class StationaryController {
  constructor(private readonly stationaryService: StationaryService) {}

  /** GET /api/v1/me/stationary-requests */
  @Get()
  findAll(@CurrentUser() user: JwtPayload) {
    return this.stationaryService.listMyRequests(user.sub);
  }

  /**
   * POST /api/v1/me/stationary-requests/order
   *
   * Error responses:
   *  400 VALIDATION_ERROR
   *  401 UNAUTHORIZED, 403 FORBIDDEN
   *  500 INTERNAL_ERROR / RAZORPAY_NOT_CONFIGURED
   */
  @Post('order')
  @HttpCode(HttpStatus.CREATED)
  createOrder(@Body() dto: CreateStationaryOrderDto, @CurrentUser() user: JwtPayload) {
    return this.stationaryService.createOrder(user.sub, dto);
  }

  /**
   * POST /api/v1/me/stationary-requests/order/verify
   *
   * Error responses:
   *  400 VALIDATION_ERROR / INVALID_WORKFLOW_STATE / PAYMENT_VERIFICATION_FAILED
   *  401 UNAUTHORIZED, 403 FORBIDDEN
   *  404 STATIONARY_REQUEST_NOT_FOUND
   *  500 INTERNAL_ERROR / RAZORPAY_NOT_CONFIGURED
   */
  @Post('order/verify')
  @HttpCode(HttpStatus.OK)
  verifyPayment(@Body() dto: VerifyStationaryPaymentDto, @CurrentUser() user: JwtPayload) {
    return this.stationaryService.verifyPayment(user.sub, dto);
  }
}
