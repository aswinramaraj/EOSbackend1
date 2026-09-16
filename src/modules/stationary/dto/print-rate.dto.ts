import { Type } from 'class-transformer';
import { IsNumber, IsOptional, IsPositive, IsString, MaxLength } from 'class-validator';

export class CreatePrintRateDto {
  @IsString()
  @MaxLength(100)
  service: string;

  @IsString()
  @MaxLength(20)
  paper_size: string;

  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  bw_price: number;

  @IsString()
  @MaxLength(20)
  bw_unit: string;

  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  colour_price: number;

  @IsString()
  @MaxLength(20)
  colour_unit: string;

  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  bulk_price: number;

  @IsString()
  @MaxLength(20)
  bulk_unit: string;
}

export class UpdatePrintRateDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  service?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  paper_size?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  bw_price?: number;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  bw_unit?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  colour_price?: number;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  colour_unit?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  bulk_price?: number;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  bulk_unit?: string;
}
