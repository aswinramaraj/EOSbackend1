import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsPositive,
} from 'class-validator';
import { Type } from 'class-transformer';

export enum InvigilationSessionValue {
  FN = 'FN',
  AN = 'AN',
}

export enum InvigilationRoleValue {
  chief = 'chief',
  relief = 'relief',
}

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

  @IsEnum(InvigilationSessionValue, { message: 'session must be FN or AN' })
  session!: InvigilationSessionValue;

  @IsOptional()
  @IsEnum(InvigilationRoleValue, { message: 'role must be chief or relief' })
  role?: InvigilationRoleValue;

  @IsOptional()
  @IsInt()
  @IsPositive()
  @Type(() => Number)
  allocation_batch_id?: number;
}
