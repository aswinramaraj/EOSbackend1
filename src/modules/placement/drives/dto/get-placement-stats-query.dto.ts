import { IsInt, IsOptional, IsPositive } from 'class-validator';
import { Type } from 'class-transformer';

export class GetPlacementStatsQueryDto {
  /** Scopes eligible-student totals, placement rate and the class/department breakdown to one batch. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  batch_id?: number;
}
