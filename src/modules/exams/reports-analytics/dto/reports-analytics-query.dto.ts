import { Type } from 'class-transformer';
import { IsInt, IsPositive } from 'class-validator';

export class ReportsAnalyticsQueryDto {
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  exam_id!: number;
}
