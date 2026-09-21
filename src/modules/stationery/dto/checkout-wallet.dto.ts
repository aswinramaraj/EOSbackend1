import { Type } from 'class-transformer';
import { ArrayMinSize, Matches, ValidateNested } from 'class-validator';
import { CheckoutItemDto } from './checkout-item.dto';

export class CheckoutWalletDto {
  @ValidateNested({ each: true })
  @Type(() => CheckoutItemDto)
  @ArrayMinSize(1)
  items: CheckoutItemDto[];

  // Same 4-digit wallet PIN as every other real debit - see
  // TransferFundsDto/SetPinDto.
  @Matches(/^\d{4}$/, { message: 'pin must be exactly 4 digits' })
  pin: string;
}
