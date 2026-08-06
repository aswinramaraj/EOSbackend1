// dto/update-revaluation.dto.ts
import {
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

const VALID_TRANSITIONS = [
  'under_review',
  'revised',
  'no_change',
  'approved',
  'rejected',
] as const;

export class UpdateRevaluationDto {
  @IsIn(VALID_TRANSITIONS, {
    message: `status must be one of: ${VALID_TRANSITIONS.join(', ')}`,
  })
  status!: (typeof VALID_TRANSITIONS)[number];

  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: 'revised_marks must be a number' })
  @Min(0, { message: 'revised_marks cannot be negative' })
  revised_marks?: number;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  remarks?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'evaluator_faculty_id must be an integer' })
  @IsPositive({ message: 'evaluator_faculty_id must be a positive integer' })
  evaluator_faculty_id?: number;
}
