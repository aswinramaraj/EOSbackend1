import {
  IsDateString,
  IsNotEmpty,
  IsPositive,
  IsString,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';

export class ScheduleSupplementaryDto {
  @IsNotEmpty({ message: 'title is required' })
  @IsString()
  @MaxLength(200, { message: 'title must not exceed 200 characters' })
  title: string;

  @IsDateString({}, { message: 'starts_on must be a valid date' })
  starts_on: string;

  @IsDateString({}, { message: 'ends_on must be a valid date' })
  ends_on: string;

  @Type(() => Number)
  @IsPositive({ message: 'fee_per_course must be a positive number' })
  fee_per_course: number;
}
