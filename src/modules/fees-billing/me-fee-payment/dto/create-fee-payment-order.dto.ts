import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsNumber,
  IsPositive,
  Min,
  ValidateNested,
} from 'class-validator';

export class FeePaymentItemDto {
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  demand_id: number;

  @Type(() => Number)
  @IsNumber()
  @Min(1)
  amount: number;
}

/**
 * POST /me/fees/pay/order — one or more fee demands paid together in a
 * single Razorpay checkout ("cart"). Amounts are in rupees (matches the
 * wallet module's CreateTopupOrderDto convention); the service converts to
 * paise only when talking to the Razorpay API itself.
 */
export class CreateFeePaymentOrderDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => FeePaymentItemDto)
  items: FeePaymentItemDto[];
}
