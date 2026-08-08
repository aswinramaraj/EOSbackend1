import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

/** One line item within a product request's `items` array. */
export class ProductRequestItemDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  product_name: string;

  @IsInt()
  @IsPositive()
  quantity: number;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  purpose?: string;
}

/**
 * POST /me/product-requests (Secretary).
 *
 * Creates a request in 'draft' status. Mirrors CreateServiceRequestDto's
 * whole-array `items` handling — see that file for why items aren't
 * separate endpoints. Use POST /me/product-requests/:id/submit to move a
 * draft to 'pending' once title and at least one item are in place.
 * `requested_by_user_id` and `status` are never client-supplied.
 */
export class CreateProductRequestDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  title: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  justification?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ProductRequestItemDto)
  items?: ProductRequestItemDto[];
}
