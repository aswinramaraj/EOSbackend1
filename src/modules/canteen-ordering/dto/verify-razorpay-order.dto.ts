import { IsString } from 'class-validator';

/**
 * POST /me/canteen-ordering/checkout/razorpay-verify — the three fields
 * Razorpay's Standard Checkout hands back to the client on success. Mirrors
 * the Stationery Store's own VerifyRazorpayOrderDto exactly.
 */
export class VerifyRazorpayOrderDto {
  @IsString()
  razorpay_order_id: string;

  @IsString()
  razorpay_payment_id: string;

  @IsString()
  razorpay_signature: string;
}
