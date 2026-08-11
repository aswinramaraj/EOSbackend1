import { IsString } from 'class-validator';

/**
 * POST /me/fees/payment-order/verify — the three fields Razorpay's
 * Standard Checkout hands back to the client on success. The server
 * independently recomputes the HMAC signature (never trusts the client's
 * "it succeeded") before recording the fee payment. Mirrors VerifyTopupDto
 * (wallet module) exactly.
 */
export class VerifyFeePaymentDto {
  @IsString()
  razorpay_order_id: string;

  @IsString()
  razorpay_payment_id: string;

  @IsString()
  razorpay_signature: string;
}
