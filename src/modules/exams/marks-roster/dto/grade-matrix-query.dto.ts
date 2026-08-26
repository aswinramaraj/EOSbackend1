import { Type } from 'class-transformer';
import { IsInt, IsPositive } from 'class-validator';

export class GradeMatrixQueryDto {
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  exam_id!: number;

  @Type(() => Number)
  @IsInt()
  @IsPositive()
  department_id!: number;
}
