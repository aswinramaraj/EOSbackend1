import { IsString } from 'class-validator';

/**
 * POST /me/stationary-requests/order/verify — the three fields Razorpay's
 * Standard Checkout hands back to the client on success. The server
 * independently recomputes the HMAC signature (never trusts the client's
 * "it succeeded") before marking the request paid - same pattern as
 * WalletService.verifyTopup.
 */
export class VerifyStationaryPaymentDto {
  @IsString()
  razorpay_order_id: string;

  @IsString()
  razorpay_payment_id: string;

  @IsString()
  razorpay_signature: string;
}
