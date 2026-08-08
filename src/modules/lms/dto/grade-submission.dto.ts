import { IsInt, Min } from 'class-validator';

/** PATCH /me/lms/submissions/:id (Faculty/HoD only, own task). */
export class GradeSubmissionDto {
  @IsInt()
  @Min(0)
  marks_obtained: number;
}
