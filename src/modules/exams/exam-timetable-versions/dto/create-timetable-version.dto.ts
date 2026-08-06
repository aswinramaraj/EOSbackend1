import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsPositive } from 'class-validator';

export class CreateTimetableVersionDto {
  @Type(() => Number)
  @IsInt({ message: 'exam_id must be an integer' })
  @IsPositive({ message: 'exam_id must be a positive integer' })
  exam_id: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'department_id must be an integer' })
  @IsPositive({ message: 'department_id must be a positive integer' })
  department_id?: number;
}
