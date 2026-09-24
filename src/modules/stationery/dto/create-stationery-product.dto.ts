import { Type } from 'class-transformer';
import { IsArray, IsEnum, IsInt, IsNumber, IsOptional, IsString, Min, MaxLength } from 'class-validator';

// Mirrors stationery_category_enum (prisma/schema.prisma) exactly.
export enum StationeryCategory {
  study = 'study',
  food = 'food',
  care = 'care',
  hostel = 'hostel',
  college = 'college',
}

export class CreateStationeryProductDto {
  @IsEnum(StationeryCategory)
  category: StationeryCategory;

  @IsString()
  @MaxLength(150)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  specs?: string[];

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  price: number;

  // Struck-through "was" price for a discount badge - must be strictly
  // above `price` (enforced again server-side in the service, not just
  // trusted from this validation).
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  original_price?: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  stock_quantity: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  image_url?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  low_stock_threshold?: number;
}
