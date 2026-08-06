import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsPositive } from 'class-validator';

export enum TimetableVersionStatus {
  draft = 'draft',
  ready_to_publish = 'ready_to_publish',
  published = 'published',
  superseded = 'superseded',
  withdrawn = 'withdrawn',
}

export class ListTimetableVersionsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'exam_id must be an integer' })
  @IsPositive({ message: 'exam_id must be a positive integer' })
  exam_id?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'department_id must be an integer' })
  @IsPositive({ message: 'department_id must be a positive integer' })
  department_id?: number;

  @IsOptional()
  @IsEnum(TimetableVersionStatus, { message: 'Invalid status value' })
  status?: TimetableVersionStatus;
}
