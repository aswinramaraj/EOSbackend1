import { Transform } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString } from 'class-validator';
import { sports_team_status_enum } from 'generated/prisma/client';

export class SearchTeamsDto {
  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  discipline_id?: number;

  @IsOptional()
  @IsEnum(sports_team_status_enum)
  status?: sports_team_status_enum;

  @IsOptional()
  @IsString()
  q?: string;
}
