import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

const RELATIONS = [
  'mou_active',
  'regular',
  'national',
  'affiliating',
  'new',
] as const;

/**
 * PATCH /me/higher-education-universities/:id
 *
 * Every field is optional — the caller sends only what changed. The service
 * rejects an empty body rather than issuing an UPDATE that sets nothing.
 */
export class UpdateUniversityDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  country?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  programmes?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  applied_count?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  admits_count?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  funded_count?: number;

  @IsOptional()
  @IsIn(RELATIONS)
  relation?: (typeof RELATIONS)[number];
}
