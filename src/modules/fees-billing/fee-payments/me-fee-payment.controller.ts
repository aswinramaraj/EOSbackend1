import { Body, Controller, Param, ParseIntPipe, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { ROLES } from 'src/common/constants/roles.constant';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { FeePaymentService } from './fee-payment.service';
import { CreateFeePaymentOrderDto } from './dto/create-fee-payment-order.dto';
import { VerifyFeePaymentDto } from './dto/verify-fee-payment.dto';

/**
 * The student-facing Razorpay fee-payment gateway - self-scoped to the
 * caller's own demand mappings (see FeePaymentService.resolveOwnDemandMapping).
 * Deliberately a separate controller from FeePaymentController, which is
 * @Roles(ROLES.ADMIN)-only for the staff/category-wise recording flow -
 * stacking a second @Roles here would only ever narrow that guard, never
 * open it to students.
 */
@Controller('me/fees')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.STUDENT)
export class MeFeePaymentController {
  constructor(private readonly feePaymentService: FeePaymentService) {}

  /**
   * POST /api/v1/me/fees/demands/:id/payment-order
   *
   * Error responses:
   *  401 UNAUTHORIZED                – missing/invalid access token
   *  403 FORBIDDEN                   – authenticated but not a student
   *  403 NOT_YOUR_DEMAND             – the mapping belongs to a different student
   *  404 STUDENT_NOT_FOUND           – caller has no linked student record
   *  404 STUDENT_FEE_DEMAND_NOT_FOUND – no demand mapping with the given id
   *  422 AMOUNT_EXCEEDS_OUTSTANDING  – amount would exceed this mapping's outstanding
   *  500 RAZORPAY_NOT_CONFIGURED / INTERNAL_ERROR
   */
  @Post('demands/:id/payment-order')
  createPaymentOrder(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateFeePaymentOrderDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.feePaymentService.createGatewayOrder(user.sub, id, dto);
  }

  /**
   * POST /api/v1/me/fees/payment-order/verify
   *
   * Error responses:
   *  401 UNAUTHORIZED                – missing/invalid access token
   *  403 FORBIDDEN                   – authenticated but not a student
   *  404 GATEWAY_ORDER_NOT_FOUND     – no order matches for this caller
   *  400 ALREADY_PROCESSED           – this order has already been verified
   *  400 PAYMENT_VERIFICATION_FAILED – signature mismatch
   *  422 AMOUNT_EXCEEDS_OUTSTANDING  – the mapping's outstanding changed since the order was staged
   *  500 RAZORPAY_NOT_CONFIGURED / INTERNAL_ERROR
   */
  @Post('payment-order/verify')
  verifyPayment(@Body() dto: VerifyFeePaymentDto, @CurrentUser() user: JwtPayload) {
    return this.feePaymentService.verifyGatewayPayment(user.sub, dto);
  }
}
