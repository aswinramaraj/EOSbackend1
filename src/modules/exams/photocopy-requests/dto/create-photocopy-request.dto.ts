import { Type } from 'class-transformer';
import { IsInt, IsPositive } from 'class-validator';

export class CreatePhotocopyRequestDto {
  @Type(() => Number)
  @IsInt({ message: 'exam_marks_id must be an integer' })
  @IsPositive({ message: 'exam_marks_id must be a positive integer' })
  exam_marks_id!: number;
}
