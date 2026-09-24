import { IsString } from 'class-validator';

/**
 * POST /me/stationery/checkout/razorpay-verify — the three fields
 * Razorpay's Standard Checkout hands back to the client on success. Mirrors
 * VerifyTopupDto (wallet module) exactly.
 */
export class VerifyRazorpayOrderDto {
  @IsString()
  razorpay_order_id: string;

  @IsString()
  razorpay_payment_id: string;

  @IsString()
  razorpay_signature: string;
}
