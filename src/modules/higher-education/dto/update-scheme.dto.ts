import { Type } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * PATCH /me/higher-education-scholarship-schemes/:id
 *
 * Partial by design: only the changed fields are sent. An empty body is
 * rejected by the service rather than producing an UPDATE that sets nothing.
 */
export class UpdateSchemeDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  scheme_type?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  academic_year?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  status?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  applied_count?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  awarded_count?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  total_value?: number;
}
