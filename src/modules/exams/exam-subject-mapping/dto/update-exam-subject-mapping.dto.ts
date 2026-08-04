import { IsInt, IsOptional, IsPositive } from 'class-validator';
import { Type } from 'class-transformer';

export class UpdateExamSubjectMappingDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'exam_id must be an integer' })
  @IsPositive({ message: 'exam_id must be a positive integer' })
  exam_id?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'class_id must be an integer' })
  @IsPositive({ message: 'class_id must be a positive integer' })
  class_id?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'subject_id must be an integer' })
  @IsPositive({ message: 'subject_id must be a positive integer' })
  subject_id?: number;
}
