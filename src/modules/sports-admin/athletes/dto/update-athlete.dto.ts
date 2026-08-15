import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { sports_athlete_status_enum } from 'generated/prisma/client';

/** PATCH /sports-admin/athletes/:id — only status/discipline/registered year are editable. */
export class UpdateAthleteDto {
  @IsOptional()
  @IsInt()
  primary_discipline_id?: number;

  @IsOptional()
  @IsEnum(sports_athlete_status_enum)
  status?: sports_athlete_status_enum;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  registered_academic_year?: string;
}
