import { Type } from 'class-transformer';
import { IsInt, IsPositive } from 'class-validator';

export class ResultsSummaryQueryDto {
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  exam_id!: number;
}
