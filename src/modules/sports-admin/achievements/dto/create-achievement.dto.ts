import {
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreateAchievementDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  event_name: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  result: string;

  @IsDateString()
  achievement_date: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  level?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  venue?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  certificate_url?: string;

  /** Set for a team result. Either this or athlete_student_id is required. */
  @IsOptional()
  @IsInt()
  team_id?: number;

  /** Set for an individual result. Either this or team_id is required. */
  @IsOptional()
  @IsInt()
  athlete_student_id?: number;
}
