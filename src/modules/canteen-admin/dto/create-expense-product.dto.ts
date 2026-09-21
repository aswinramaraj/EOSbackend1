import { Type } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  MaxLength,
} from 'class-validator';

export class CreateExpenseProductDto {
  @IsNotEmpty()
  @MaxLength(150)
  product_name: string;

  @IsOptional()
  @IsInt()
  category_id?: number;

  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  price_per_unit: number;
}
