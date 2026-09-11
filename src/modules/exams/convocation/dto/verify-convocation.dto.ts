import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
} from 'class-validator';

export class VerifyConvocationDto {
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  student_id: number;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  convocation_batch?: string;

  @IsOptional()
  @IsBoolean()
  merit_list_eligible?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  remarks?: string;
}
