import { IsBoolean, IsDateString, IsOptional, IsString, MaxLength } from 'class-validator';

/** PATCH /me/lms/lesson-plan/sessions/:id (Faculty/HoD only, own session). */
export class UpdateLessonSessionDto {
  @IsOptional()
  @IsDateString()
  session_date?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  unit_title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  topic?: string;

  @IsOptional()
  @IsBoolean()
  is_covered?: boolean;
}
