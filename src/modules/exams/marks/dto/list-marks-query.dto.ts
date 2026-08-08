import { Type } from 'class-transformer';
import { IsInt, IsOptional } from 'class-validator';

export class ListMarksQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  student_id?: number;
}
