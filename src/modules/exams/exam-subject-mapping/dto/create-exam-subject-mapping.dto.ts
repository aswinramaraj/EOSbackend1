import { IsInt, IsPositive } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateExamSubjectMappingDto {
  @Type(() => Number)
  @IsInt({ message: 'exam_id must be an integer' })
  @IsPositive({ message: 'exam_id must be a positive integer' })
  exam_id!: number;

  @Type(() => Number)
  @IsInt({ message: 'class_id must be an integer' })
  @IsPositive({ message: 'class_id must be a positive integer' })
  class_id!: number;
}
