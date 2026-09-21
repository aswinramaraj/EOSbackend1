import { IsBoolean, IsInt, IsOptional, IsPositive } from 'class-validator';

export class CreateBillItemDto {
  @IsInt()
  dish_id: number;

  @IsInt()
  @IsPositive()
  quantity: number;

  @IsOptional()
  @IsBoolean()
  is_parcel?: boolean = false;
}
