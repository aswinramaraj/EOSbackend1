import { Type } from 'class-transformer';
import { IsDateString, IsEnum, IsInt, IsPositive } from 'class-validator';

export enum AllocationBatchSessionValue {
  FN = 'FN',
  AN = 'AN',
}

export class CreateAllocationBatchDto {
  @Type(() => Number)
  @IsInt({ message: 'exam_id must be an integer' })
  @IsPositive({ message: 'exam_id must be a positive integer' })
  exam_id: number;

  @IsDateString({}, { message: 'exam_date must be a valid date (YYYY-MM-DD)' })
  exam_date: string;

  @IsEnum(AllocationBatchSessionValue, { message: 'session must be FN or AN' })
  session: AllocationBatchSessionValue;
}
