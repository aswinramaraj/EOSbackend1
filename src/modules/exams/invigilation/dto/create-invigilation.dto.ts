import { IsDateString, IsEnum, IsInt, IsPositive } from 'class-validator';
import { Type } from 'class-transformer';
import { exam_session_enum } from '../../../../../generated/prisma/enums';

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

  @IsEnum(exam_session_enum, { message: 'session must be one of FN, AN' })
  session!: exam_session_enum;
}
