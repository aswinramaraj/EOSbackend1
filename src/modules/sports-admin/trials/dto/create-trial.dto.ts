import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { TrialScoreDto } from './trial-score.dto';

export class CreateTrialDto {
  @IsInt()
  student_id: number;

  @IsInt()
  discipline_id: number;

  @IsOptional()
  @IsInt()
  target_team_id?: number;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  round_label?: string;

  /** ISO datetime string, e.g. 2026-08-20T10:00:00.000Z */
  @IsDateString()
  trial_at: string;

  @IsOptional()
  @IsInt()
  facility_id?: number;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  panel?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => TrialScoreDto)
  scores?: TrialScoreDto[];
}
