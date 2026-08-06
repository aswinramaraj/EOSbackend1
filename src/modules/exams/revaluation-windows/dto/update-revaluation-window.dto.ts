import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  Min,
} from 'class-validator';

export enum RevaluationApplicationType {
  photocopy_and_reval = 'photocopy_and_reval',
  photocopy_only = 'photocopy_only',
  reval_only = 'reval_only',
}

export class UpdateRevaluationWindowDto {
  @IsOptional()
  @IsEnum(RevaluationApplicationType, { message: 'Invalid application_type' })
  application_type?: RevaluationApplicationType;

  @IsOptional()
  @IsDateString({}, { message: 'opens_at must be a valid ISO date-time' })
  opens_at?: string;

  @IsOptional()
  @IsDateString({}, { message: 'closes_at must be a valid ISO date-time' })
  closes_at?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: 'fee_per_paper must be a number' })
  @Min(0, { message: 'fee_per_paper cannot be negative' })
  fee_per_paper?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: 'photocopy_fee_per_paper must be a number' })
  @Min(0, { message: 'photocopy_fee_per_paper cannot be negative' })
  photocopy_fee_per_paper?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'max_papers_per_student must be an integer' })
  @IsPositive({ message: 'max_papers_per_student must be a positive integer' })
  max_papers_per_student?: number;
}
