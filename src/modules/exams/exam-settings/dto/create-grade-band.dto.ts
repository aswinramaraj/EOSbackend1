import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateGradeBandDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(10)
  grade_label!: string;

  @Type(() => Number)
  @IsNumber({}, { message: 'min_percentage must be a number' })
  @Min(0)
  @Max(100)
  min_percentage!: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: 'grade_point must be a number' })
  @Min(0)
  grade_point?: number;

  @IsOptional()
  @IsBoolean()
  is_pass?: boolean;

  @Type(() => Number)
  @IsInt({ message: 'display_order must be an integer' })
  display_order!: number;
}
