import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsPositive,
  IsDateString,
} from 'class-validator';

export enum ExamSessionValue {
  FN = 'FN',
  AN = 'AN',
}

export class CreateSeatingPlanVersionDto {
  @Type(() => Number)
  @IsInt({ message: 'exam_id must be an integer' })
  @IsPositive({ message: 'exam_id must be a positive integer' })
  exam_id: number;

  @IsNotEmpty({ message: 'exam_date is required' })
  @IsDateString({}, { message: 'exam_date must be a valid date (YYYY-MM-DD)' })
  exam_date: string;

  @IsEnum(ExamSessionValue, { message: 'session must be FN or AN' })
  session: ExamSessionValue;
}
