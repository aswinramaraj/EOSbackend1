import {
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreateTeamDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  name: string;

  @IsOptional()
  @IsInt()
  discipline_id?: number;

  @IsOptional()
  @IsInt()
  coach_faculty_id?: number;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  category?: string;

  @IsOptional()
  @IsInt()
  captain_student_id?: number;

  @IsOptional()
  @IsInt()
  vice_captain_student_id?: number;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  manager_name?: string;

  @IsOptional()
  @IsInt()
  facility_id?: number;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  practice_schedule?: string;

  @IsOptional()
  @IsDateString()
  formed_date?: string;
}
