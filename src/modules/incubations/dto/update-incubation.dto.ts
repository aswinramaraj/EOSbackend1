import { IsDateString, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

const STATUSES = ['Active', 'Graduated', 'Exited'] as const;

/** PATCH /me/incubations/:id — periodic review updates (status, progress,
 * review notes) by the EDC coordinator. All fields optional/partial. */
export class UpdateIncubationDto {
  @IsOptional()
  @IsString()
  @MaxLength(50)
  intake_label?: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  seat?: string;

  @IsOptional()
  @IsInt()
  mentor_faculty_id?: number;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  review_attendance_note?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  last_review_note?: string;

  @IsOptional()
  @IsDateString()
  next_review_date?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  grant_note?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  services_note?: string;

  @IsOptional()
  @IsIn(STATUSES)
  status?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  progress_percent?: number;
}
