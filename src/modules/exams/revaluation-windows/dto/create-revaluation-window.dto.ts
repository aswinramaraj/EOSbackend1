import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { revaluation_application_type_enum } from 'generated/prisma/client';

export class CreateRevaluationWindowDto {
  @IsInt()
  @IsPositive()
  @Type(() => Number)
  exam_id!: number;

  @IsOptional()
  @IsEnum(revaluation_application_type_enum, {
    message: `application_type must be one of: ${Object.values(revaluation_application_type_enum).join(', ')}`,
  })
  application_type?: revaluation_application_type_enum;

  @IsOptional()
  @IsBoolean()
  is_open?: boolean;

  @IsOptional()
  @IsDateString()
  opens_at?: string;

  @IsOptional()
  @IsDateString()
  closes_at?: string;

  @IsNumber()
  @Min(0)
  fee_per_paper!: number;

  @IsNumber()
  @Min(0)
  photocopy_fee_per_paper!: number;

  @IsOptional()
  @IsInt()
  @IsPositive()
  @Type(() => Number)
  max_papers_per_student?: number;
}
