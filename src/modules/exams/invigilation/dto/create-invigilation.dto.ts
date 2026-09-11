import { IsDateString, IsEnum, IsIn, IsInt, IsOptional, IsPositive } from 'class-validator';
import { Type } from 'class-transformer';
import { exam_session_enum, invigilation_role_enum } from 'generated/prisma/client';

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

  @IsEnum(exam_session_enum, {
    message: `session must be one of: ${Object.values(exam_session_enum).join(', ')}`,
  })
  session!: exam_session_enum;

  // Optional — the model has always had chief/relief (default relief); no
  // caller passed it before, so this only widens what's possible.
  @IsOptional()
  @IsEnum(invigilation_role_enum, {
    message: `role must be one of: ${Object.values(invigilation_role_enum).join(', ')}`,
  })
  role?: invigilation_role_enum;

  @IsOptional()
  @IsIn(['regular', 'relief_pool', 'squad'])
  duty_type?: 'regular' | 'relief_pool' | 'squad';
}
