import {
  IsNotEmpty,
  IsNumber,
  IsOptional,
  Min,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateIngredientDto {
  @IsNotEmpty()
  @MaxLength(150)
  name: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  stock_quantity?: number = 0;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  price_per_unit: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  threshold?: number = 0;
}
