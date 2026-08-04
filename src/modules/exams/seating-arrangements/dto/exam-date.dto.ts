import { IsDateString, IsInt, IsPositive } from 'class-validator';
import { Type } from 'class-transformer';

export class ExamDateDto {
  @IsInt()
  @IsPositive()
  @Type(() => Number)
  exam_id!: number;

  @IsDateString()
  exam_date!: string;
}
