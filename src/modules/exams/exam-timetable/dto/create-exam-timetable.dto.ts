// dto/create-exam-timetable.dto.ts
import {
  IsBoolean,
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsPositive,
  Matches,
} from 'class-validator';
import { Type } from 'class-transformer';

const TIME_REGEX = /^([01]\d|2[0-3]):([0-5]\d)(:[0-5]\d)?$/;

export class CreateExamTimetableDto {
  @Type(() => Number)
  @IsInt({ message: 'exam_subject_mapping_id must be an integer' })
  @IsPositive({ message: 'exam_subject_mapping_id must be a positive integer' })
  exam_subject_mapping_id!: number;

  @IsNotEmpty({ message: 'exam_date is required' })
  @IsDateString({}, { message: 'exam_date must be a valid date (YYYY-MM-DD)' })
  exam_date!: string;

  @IsNotEmpty({ message: 'start_time is required' })
  @Matches(TIME_REGEX, {
    message: 'start_time must be in HH:mm or HH:mm:ss format',
  })
  start_time!: string;

  @IsNotEmpty({ message: 'end_time is required' })
  @Matches(TIME_REGEX, {
    message: 'end_time must be in HH:mm or HH:mm:ss format',
  })
  end_time!: string;

  @IsOptional()
  @IsBoolean({ message: 'is_published must be a boolean' })
  is_published?: boolean;
}
