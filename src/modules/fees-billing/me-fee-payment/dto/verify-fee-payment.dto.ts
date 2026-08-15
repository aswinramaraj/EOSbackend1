import { IsString } from 'class-validator';

/**
 * POST /me/fees/pay/verify — the three fields Razorpay's Standard Checkout
 * hands back to the client on success. Mirrors wallet's VerifyTopupDto:
 * demand_id and amount are deliberately NOT accepted here — they're
 * re-derived server-side from the verified Razorpay order's own notes/
 * amount (see MeFeePaymentService.verifyPayment), so a client can't claim
 * a different demand or amount than what was actually authorized.
 */
export class VerifyFeePaymentDto {
  @IsString()
  razorpay_order_id: string;

  @IsString()
  razorpay_payment_id: string;

  @IsString()
  razorpay_signature: string;
}
