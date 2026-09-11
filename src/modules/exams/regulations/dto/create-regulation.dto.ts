import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateRegulationDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  code: string;

  @IsIn(['UG', 'PG'])
  applies_to_level: 'UG' | 'PG';

  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  applies_to_description: string;

  @Type(() => Number)
  @IsInt()
  @Min(1990)
  @Max(2100)
  intake_start_year: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1990)
  @Max(2100)
  intake_end_year?: number;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  grading_scale?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  pass_aggregate_pct?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  pass_external_pct?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  attendance_threshold_pct?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  moderation_ceiling_marks?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  moderation_ceiling_candidate_pct?: number;

  @IsOptional()
  @IsIn(['active', 'phasing_out', 'draft'])
  status?: 'active' | 'phasing_out' | 'draft';
}
