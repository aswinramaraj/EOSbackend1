import { Type } from 'class-transformer';
import {
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

const STAGES = ['interested', 'applied', 'admitted', 'enrolled'] as const;

/**
 * PATCH /me/higher-education-aspirants/:id
 *
 * Edits the aspiration record, not the student. `register_no` is deliberately
 * absent: it identifies which student the record belongs to, and re-pointing a
 * record at a different student would silently rewrite history — a wrong
 * record should be deleted and re-added instead.
 */
export class UpdateAspirantDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  programme?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  country?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  university?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  intake?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  cgpa?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  percentage?: number;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  test_scores_summary?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  scholarship_name?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  scholarship_value?: number;

  @IsOptional()
  @IsIn(STAGES)
  stage?: (typeof STAGES)[number];

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  remarks?: string;
}
