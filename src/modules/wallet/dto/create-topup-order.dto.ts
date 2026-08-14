import { Type } from 'class-transformer';
import { IsNumber, Min } from 'class-validator';

/**
 * POST /me/wallet/topup/order — amount is in rupees (whole app's Decimal
 * columns are rupee-denominated everywhere else, e.g. fee_payments); this
 * DTO converts to paise only when talking to the Razorpay API itself, in
 * the service.
 */
export class CreateTopupOrderDto {
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  amount: number;
}
