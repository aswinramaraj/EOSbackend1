import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { StationaryService } from './stationary.service';
import { CreateStationaryOrderDto } from './dto/create-stationary-order.dto';
import { VerifyStationaryPaymentDto } from './dto/verify-stationary-payment.dto';

/**
 * The print/xerox shop request gateway - open to any authenticated user,
 * no @Roles() restriction. The mobile app's own Amenity tab already hides
 * this tile for Principal (see AmenityHomeScreen - "Principal has no use
 * for canteen/stationery ordering"), so there's no separate server-side
 * role list to keep in sync with that UI-only choice, same reasoning
 * medical-centre appointment booking uses ("everyone except a parent").
 */
@Controller('me/stationary-requests')
@UseGuards(JwtAuthGuard, RolesGuard)
export class StationaryController {
  constructor(private readonly stationaryService: StationaryService) {}

  /**
   * POST /api/v1/me/stationary-requests/order
   *
   * Error responses:
   *  400 VALIDATION_ERROR       – missing/invalid fields
   *  401 UNAUTHORIZED           – missing/invalid access token
   *  500 RAZORPAY_NOT_CONFIGURED / INTERNAL_ERROR
   */
  @Post('order')
  createOrder(@Body() dto: CreateStationaryOrderDto, @CurrentUser() user: JwtPayload) {
    return this.stationaryService.createOrder(user.sub, dto);
  }

  /**
   * POST /api/v1/me/stationary-requests/order/verify
   *
   * Error responses:
   *  401 UNAUTHORIZED                 – missing/invalid access token
   *  400 ALREADY_PROCESSED            – this order has already been verified
   *  400 PAYMENT_VERIFICATION_FAILED  – signature mismatch
   *  404 STATIONARY_ORDER_NOT_FOUND   – no order matches for this caller
   *  500 RAZORPAY_NOT_CONFIGURED / INTERNAL_ERROR
   */
  @Post('order/verify')
  verifyPayment(@Body() dto: VerifyStationaryPaymentDto, @CurrentUser() user: JwtPayload) {
    return this.stationaryService.verifyPayment(user.sub, dto);
  }
}
