// dto/update-revaluation.dto.ts
import {
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { OptionalRemarks } from '../../../../common/dto/decision-reason.dto';

export class UpdateRevaluationDto {
  // approved/rejected added — the schema's revaluation_status_enum already
  // had them, but no code path could ever reach them before this.
  @IsOptional()
  @IsIn(['under_review', 'revised', 'no_change', 'approved', 'rejected'], {
    message:
      'status must be one of: under_review, revised, no_change, approved, rejected',
  })
  status?: 'under_review' | 'revised' | 'no_change' | 'approved' | 'rejected';

  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: 'revised_marks must be a number' })
  @Min(0, { message: 'revised_marks cannot be negative' })
  revised_marks?: number;

  // Existing column (evaluator_faculty_id) — assignable independently of status.
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'evaluator_faculty_id must be an integer' })
  @IsPositive({ message: 'evaluator_faculty_id must be a positive integer' })
  evaluator_faculty_id?: number;

  // Real once decision_reason_columns.query.md's revaluation_requests.decision_remarks
  // runs — the reviewer's own reject reason. Distinct from `remarks` (the
  // applicant's own submitted text at creation, never touched by update()).
  @OptionalRemarks()
  decision_remarks?: string;
}
