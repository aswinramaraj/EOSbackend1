import { IsDateString, IsInt, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * POST /me/lms/lesson-plan/sessions (Faculty/HoD only).
 * Upserts the parent lesson_plans row (unique per faculty/subject/class/
 * semester) automatically before appending the session - the caller never
 * manages the parent row directly.
 */
export class CreateLessonSessionDto {
  @IsInt()
  subject_id: number;

  @IsInt()
  class_id: number;

  @IsDateString()
  session_date: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  unit_title?: string;

  @IsString()
  @MaxLength(300)
  topic: string;
}
