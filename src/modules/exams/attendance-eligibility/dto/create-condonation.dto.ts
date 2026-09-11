import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsPositive, IsString, MaxLength } from 'class-validator';

export class CreateCondonationDto {
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  student_id: number;

  @Type(() => Number)
  @IsInt()
  @IsPositive()
  exam_id: number;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  reason?: string;
}
