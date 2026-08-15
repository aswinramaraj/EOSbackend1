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

/**
 * Written by hand rather than `PartialType(CreateTrialDto)` — same reasoning
 * as achievements/dto/update-achievement.dto.ts: `scores` is a nested array
 * with its own replace-all semantics on update, not a diff, so it's clearer
 * to spell every field out here than to trust it survives PartialType.
 */
export class UpdateTrialDto {
  @IsOptional()
  @IsInt()
  student_id?: number;

  @IsOptional()
  @IsInt()
  discipline_id?: number;

  @IsOptional()
  @IsInt()
  target_team_id?: number;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  round_label?: string;

  @IsOptional()
  @IsDateString()
  trial_at?: string;

  @IsOptional()
  @IsInt()
  facility_id?: number;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  panel?: string;

  /** When provided, replaces ALL existing sports_trial_scores for this trial. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => TrialScoreDto)
  scores?: TrialScoreDto[];
}
