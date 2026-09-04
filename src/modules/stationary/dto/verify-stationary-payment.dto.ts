import { IsString } from 'class-validator';

/**
 * POST /me/stationary-requests/order/verify — the three fields Razorpay's
 * Standard Checkout hands back to the client on success. Mirrors
 * VerifyTopupDto exactly - the server independently recomputes the HMAC
 * signature before marking the request 'paid'.
 */
export class VerifyStationaryPaymentDto {
  @IsString()
  razorpay_order_id: string;

  @IsString()
  razorpay_payment_id: string;

  @IsString()
  razorpay_signature: string;
}
