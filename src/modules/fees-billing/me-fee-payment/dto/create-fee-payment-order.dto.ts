import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsNumber,
  IsOptional,
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

  /**
   * Optional — omit to pay against the whole demand (unchanged, original
   * behaviour). When given, this cart entry pays one specific
   * fee_structure_item within that demand's fee structure instead, capped
   * at that item's own outstanding due rather than the whole demand's.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  fee_structure_item_id?: number;
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
