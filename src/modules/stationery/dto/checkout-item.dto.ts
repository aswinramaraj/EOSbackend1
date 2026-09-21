import { Type } from 'class-transformer';
import { IsInt, Min } from 'class-validator';

export class CheckoutItemDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  product_id: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity: number;
}
