import { Type } from 'class-transformer';
import { ArrayMinSize, ValidateNested } from 'class-validator';
import { PlaceOrderItemDto } from './place-order.dto';

export class CreateRazorpayOrderDto {
  @ValidateNested({ each: true })
  @Type(() => PlaceOrderItemDto)
  @ArrayMinSize(1)
  items: PlaceOrderItemDto[];
}
