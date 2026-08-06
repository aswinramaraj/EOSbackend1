import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsPositive,
} from 'class-validator';
import { AllocationBatchSessionValue } from './create-allocation-batch.dto';

export enum AllocationBatchStatus {
  draft = 'draft',
  submitted = 'submitted',
  published = 'published',
}

export class ListAllocationBatchesQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'exam_id must be an integer' })
  @IsPositive({ message: 'exam_id must be a positive integer' })
  exam_id?: number;

  @IsOptional()
  @IsDateString({}, { message: 'exam_date must be a valid date (YYYY-MM-DD)' })
  exam_date?: string;

  @IsOptional()
  @IsEnum(AllocationBatchSessionValue, { message: 'session must be FN or AN' })
  session?: AllocationBatchSessionValue;

  @IsOptional()
  @IsEnum(AllocationBatchStatus, { message: 'Invalid status value' })
  status?: AllocationBatchStatus;
}
