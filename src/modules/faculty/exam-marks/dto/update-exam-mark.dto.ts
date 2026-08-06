import { IsBoolean, IsNumber, IsOptional, Min } from 'class-validator';

/**
 * PATCH /me/exam-marks/:id (Faculty only — the faculty who entered it).
 * Corrects a wrongly-entered mark, or flips absence. max_marks was fixed
 * for the whole batch at entry time and isn't reassignable per-row after
 * the fact. The [0, max_marks] range is re-checked against the row's own
 * stored max_marks in the service. At least one of the two fields must be
 * present — enforced in the service since it's a cross-field check.
 */
export class UpdateExamMarkDto {
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  marks_obtained?: number;

  @IsOptional()
  @IsBoolean()
  is_absent?: boolean;
}
