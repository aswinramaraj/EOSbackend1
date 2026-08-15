import { IsInt, IsNotEmpty, IsOptional, IsString, Min, MaxLength } from 'class-validator';

/** One row of `sports_trial_scores` nested inside a create/update trial payload. */
export class TrialScoreDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  criterion: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  score: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  sort_order?: number;
}
