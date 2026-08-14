import { Transform } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString } from 'class-validator';
import { sports_athlete_status_enum } from 'generated/prisma/client';

export class SearchAthletesDto {
  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  discipline_id?: number;

  @IsOptional()
  @IsEnum(sports_athlete_status_enum)
  status?: sports_athlete_status_enum;

  @IsOptional()
  @IsString()
  q?: string;
}
