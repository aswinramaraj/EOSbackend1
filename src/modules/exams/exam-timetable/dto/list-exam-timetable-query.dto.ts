import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsPositive } from 'class-validator';

export class ListExamTimetableQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'version_id must be an integer' })
  @IsPositive({ message: 'version_id must be a positive integer' })
  version_id?: number;
}
