import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { sports_athlete_status_enum } from 'generated/prisma/client';

export class CreateAthleteDto {
  @IsInt()
  student_id: number;

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
