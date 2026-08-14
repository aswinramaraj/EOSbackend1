import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString } from 'class-validator';
import { sports_trial_status_enum } from 'generated/prisma/client';

export class SearchTrialsDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  discipline_id?: number;

  @IsOptional()
  @IsEnum(sports_trial_status_enum)
  status?: sports_trial_status_enum;

  /** Free-text search across student name, register/ID no, round label and panel. */
  @IsOptional()
  @IsString()
  q?: string;
}
