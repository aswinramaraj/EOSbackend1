import { IsDateString, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * department_id and media are deliberately excluded — the achievement stays
 * with the department it was posted under, and media is managed through the
 * dedicated add/remove-media endpoints rather than diffed here.
 */
export class UpdateAchievementDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsDateString()
  achievement_date?: string;
}
