import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsPositive, IsString } from 'class-validator';

export class ListCourseResultsQueryDto {
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  exam_id: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  department_id?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  semester?: number;

  @IsOptional()
  @IsIn(['computed', 'approved', 'published', 'awaiting_pass_board'])
  status?: 'computed' | 'approved' | 'published' | 'awaiting_pass_board';

  @IsOptional()
  @IsString()
  search?: string;
}
