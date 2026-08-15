import { IsOptional, IsString } from 'class-validator';

export class SearchAchievementsDto {
  @IsOptional()
  @IsString()
  level?: string;

  @IsOptional()
  @IsString()
  q?: string;
}
