import { IsDateString, IsInt, IsOptional, IsString, MaxLength } from 'class-validator';

/** POST /me/incubations — admits a venture into the incubation centre.
 * student_entrepreneurship_id is @unique on the incubations table, so a
 * venture already incubated is rejected (see service). */
export class CreateIncubationDto {
  @IsInt()
  student_entrepreneurship_id: number;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  intake_label?: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  seat?: string;

  @IsOptional()
  @IsDateString()
  incubated_since?: string;

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
}
