import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsPositive,
} from 'class-validator';
import { ExamSessionValue } from './create-seating-plan-version.dto';

export enum SeatingPlanVersionStatus {
  draft = 'draft',
  ready_to_publish = 'ready_to_publish',
  published = 'published',
  superseded = 'superseded',
  withdrawn = 'withdrawn',
}

export class ListSeatingPlanVersionsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'exam_id must be an integer' })
  @IsPositive({ message: 'exam_id must be a positive integer' })
  exam_id?: number;

  @IsOptional()
  @IsDateString({}, { message: 'exam_date must be a valid date (YYYY-MM-DD)' })
  exam_date?: string;

  @IsOptional()
  @IsEnum(ExamSessionValue, { message: 'session must be FN or AN' })
  session?: ExamSessionValue;

  @IsOptional()
  @IsEnum(SeatingPlanVersionStatus, { message: 'Invalid status value' })
  status?: SeatingPlanVersionStatus;
}
