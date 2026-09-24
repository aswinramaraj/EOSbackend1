import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Min,
  MaxLength,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';

// class-transformer's @Type(() => Boolean) calls the native `Boolean(value)`
// cast, which makes the STRING "false" (as multipart/form-data always sends
// this field) coerce to `true` — any non-empty string is truthy. This
// endpoint is multipart-only (dish image upload), so every field always
// arrives as a string; parse it explicitly instead of relying on the
// built-in Boolean type coercion.
function parseBoolean({ value }: { value: unknown }): boolean {
  return value === true || value === 'true';
}

export class CreateDishDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  name: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  category_id?: number;

  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  price: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  stock_quantity?: number = 0;

  @IsOptional()
  @Transform(parseBoolean)
  @IsBoolean()
  is_veg?: boolean = true;

  @IsOptional()
  @Transform(parseBoolean)
  @IsBoolean()
  is_available?: boolean = true;

  @IsOptional()
  @Transform(parseBoolean)
  @IsBoolean()
  parcel_available?: boolean = true;
}
