import { Type } from 'class-transformer';
import {
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  MaxLength,
} from 'class-validator';

export class CreateExpenseDto {
  @IsNotEmpty()
  @MaxLength(150)
  name: string;

  @IsOptional()
  @IsInt()
  category_id?: number;

  @IsOptional()
  @MaxLength(150)
  vendor_name?: string;

  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  quantity: number;

  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  total_amount: number;

  @IsOptional()
  @IsDateString()
  date?: string;
}
