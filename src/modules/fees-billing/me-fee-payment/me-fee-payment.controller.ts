import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { ROLES } from 'src/common/constants/roles.constant';
import { MeFeePaymentService } from './me-fee-payment.service';
import { CreateFeePaymentOrderDto } from './dto/create-fee-payment-order.dto';
import { VerifyFeePaymentDto } from './dto/verify-fee-payment.dto';

/**
 * Self-service online fee payment via Razorpay. Additive: the existing
 * admin-only fee-payments module (cash/DD/etc. receipt entry) is untouched;
 * this is a separate student-facing checkout flow that lands in the same
 * fee_payments table, no schema change.
 */
@Controller('me/fees/pay')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.STUDENT)
export class MeFeePaymentController {
  constructor(private readonly meFeePaymentService: MeFeePaymentService) {}

  @Post('order')
  createOrder(@Body() dto: CreateFeePaymentOrderDto, @CurrentUser() user: JwtPayload) {
    return this.meFeePaymentService.createOrder(user.sub, dto);
  }

  @Post('verify')
  verify(@Body() dto: VerifyFeePaymentDto, @CurrentUser() user: JwtPayload) {
    return this.meFeePaymentService.verifyPayment(user.sub, dto);
  }
}
