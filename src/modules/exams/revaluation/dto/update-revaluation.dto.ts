// dto/update-revaluation.dto.ts
import { IsIn, IsNumber, IsOptional, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class UpdateRevaluationDto {
  @IsIn(['under_review', 'revised', 'no_change'], {
    message: 'status must be one of: under_review, revised, no_change',
  })
  status!: 'under_review' | 'revised' | 'no_change';

  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: 'revised_marks must be a number' })
  @Min(0, { message: 'revised_marks cannot be negative' })
  revised_marks?: number;
}
