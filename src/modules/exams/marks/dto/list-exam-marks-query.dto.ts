import { Transform } from 'class-transformer';
import { IsInt, IsOptional, Min } from 'class-validator';

/**
 * GET /exam-marks — was previously unfiltered (returned every mark for every
 * student regardless of what the caller asked for). `student_id` is the one
 * real consumer today (the admin student-profile "Examinations & results"
 * panel); left plain/optional rather than paginated since callers so far
 * always scope to one student.
 */
export class ListExamMarksQueryDto {
  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  student_id?: number;
}
