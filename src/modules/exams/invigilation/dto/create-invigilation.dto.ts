import {
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsPositive,
  IsString,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateInvigilationDto {
  @IsInt()
  @IsPositive()
  @Type(() => Number)
  exam_id!: number;

  @IsInt()
  @IsPositive()
  @Type(() => Number)
  hall_plan_id!: number;

  @IsInt()
  @IsPositive()
  @Type(() => Number)
  faculty_id!: number;

  @IsDateString()
  duty_date!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  shift!: string;
}
