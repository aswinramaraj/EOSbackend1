import { Type } from 'class-transformer';
import { IsInt, IsNumber, IsPositive, Min } from 'class-validator';

export class CreatePhotocopyRequestDto {
  @Type(() => Number)
  @IsInt({ message: 'exam_marks_id must be an integer' })
  @IsPositive({ message: 'exam_marks_id must be a positive integer' })
  exam_marks_id!: number;

  @Type(() => Number)
  @IsInt({ message: 'student_id must be an integer' })
  @IsPositive({ message: 'student_id must be a positive integer' })
  student_id!: number;

  // No institution-wide photocopy fee setting exists anywhere (unlike
  // revaluation/retotaling, which have revaluation_windows.fee_per_paper) —
  // the counter clerk enters the real amount actually collected.
  @Type(() => Number)
  @IsNumber({}, { message: 'fee_amount must be a number' })
  @Min(0, { message: 'fee_amount cannot be negative' })
  fee_amount!: number;
}
