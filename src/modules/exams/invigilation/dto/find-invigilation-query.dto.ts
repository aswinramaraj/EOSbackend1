import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsPositive,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PaginationDto } from 'src/common/dto/pagination.dto';
import {
  InvigilationRoleValue,
  InvigilationSessionValue,
} from './create-invigilation.dto';

export class FindInvigilationQueryDto extends PaginationDto {
  @IsOptional()
  @IsInt()
  @IsPositive()
  @Type(() => Number)
  exam_id?: number;

  @IsOptional()
  @IsInt()
  @IsPositive()
  @Type(() => Number)
  hall_plan_id?: number;

  @IsOptional()
  @IsInt()
  @IsPositive()
  @Type(() => Number)
  faculty_id?: number;

  @IsOptional()
  @IsDateString()
  duty_date?: string;

  @IsOptional()
  @IsEnum(InvigilationSessionValue, { message: 'session must be FN or AN' })
  session?: InvigilationSessionValue;

  @IsOptional()
  @IsEnum(InvigilationRoleValue, { message: 'role must be chief or relief' })
  role?: InvigilationRoleValue;
}
