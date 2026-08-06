import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsPositive,
} from 'class-validator';
import { PaginationDto } from 'src/common/dto/pagination.dto';
import {
  MalpracticeAction,
  MalpracticeNature,
} from './create-malpractice-incident.dto';

export class FindMalpracticeQueryDto extends PaginationDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  student_id?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  exam_id?: number;

  @IsOptional()
  @IsEnum(MalpracticeNature, { message: 'Invalid nature value' })
  nature?: MalpracticeNature;

  @IsOptional()
  @IsEnum(MalpracticeAction, { message: 'Invalid action_taken value' })
  action_taken?: MalpracticeAction;

  @IsOptional()
  @IsDateString({}, { message: 'date_from must be a valid date (YYYY-MM-DD)' })
  date_from?: string;

  @IsOptional()
  @IsDateString({}, { message: 'date_to must be a valid date (YYYY-MM-DD)' })
  date_to?: string;
}
