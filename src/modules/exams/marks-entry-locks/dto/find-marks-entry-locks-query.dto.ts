import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsPositive } from 'class-validator';

export class FindMarksEntryLocksQueryDto {
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  exam_id!: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  department_id?: number;
}
