import { Type } from 'class-transformer';
import { IsNumber, Min } from 'class-validator';

/**
 * POST /me/fees/demands/:id/payment-order — amount is in rupees (this
 * mapping's outstanding, or less for a partial payment); converted to
 * paise only when talking to the Razorpay API itself, in the service.
 * Mirrors CreateTopupOrderDto (wallet module) exactly.
 */
export class CreateFeePaymentOrderDto {
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  amount: number;
}
