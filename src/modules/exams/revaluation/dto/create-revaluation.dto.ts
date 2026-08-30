// dto/create-revaluation.dto.ts
import { IsBoolean, IsIn, IsInt, IsOptional, IsPositive, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateRevaluationDto {
  @Type(() => Number)
  @IsInt({ message: 'exam_marks_id must be an integer' })
  @IsPositive({ message: 'exam_marks_id must be a positive integer' })
  exam_marks_id!: number;

  @Type(() => Number)
  @IsInt({ message: 'student_id must be an integer' })
  @IsPositive({ message: 'student_id must be a positive integer' })
  student_id!: number;

  // Both optional so the existing student-side apply flow (which never sent
  // either) keeps defaulting exactly as before (schema default: revaluation,
  // fee_paid false) — only the new COE counter-entry flow sets them.
  @IsOptional()
  @IsIn(['revaluation', 'retotaling'])
  request_kind?: 'revaluation' | 'retotaling';

  @IsOptional()
  @MaxLength(1000)
  remarks?: string;

  @IsOptional()
  @IsBoolean()
  fee_paid?: boolean;
}
