import { Type } from 'class-transformer';
import { IsNumber, IsOptional, IsPositive, IsString, MaxLength } from 'class-validator';

export class CreateFinishingRateDto {
  @IsString()
  @MaxLength(100)
  item_name: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  note?: string;

  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  price: number;
}

export class UpdateFinishingRateDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  item_name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  note?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  price?: number;
}
