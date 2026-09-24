import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsPositive,
  Matches,
  ValidateNested,
} from 'class-validator';

export class PlaceOrderItemDto {
  @IsInt()
  dish_id: number;

  @IsInt()
  @IsPositive()
  quantity: number;

  @IsOptional()
  @IsBoolean()
  is_parcel?: boolean = false;
}

export class PlaceOrderDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PlaceOrderItemDto)
  items: PlaceOrderItemDto[];

  // Same 4-digit wallet PIN gate as every other real wallet debit
  // (WalletService.debitForPurchase requires one) - matches
  // CheckoutWalletDto's own @Matches convention in the Stationery Store.
  @Matches(/^\d{4}$/)
  pin: string;
}
