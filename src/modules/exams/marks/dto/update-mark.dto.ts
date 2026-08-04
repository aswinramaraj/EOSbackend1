// dto/update-mark.dto.ts
import { IsInt, IsNumber, IsOptional, IsPositive, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class UpdateMarkDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: 'marks_obtained must be a number' })
  @Min(0, { message: 'marks_obtained cannot be negative' })
  marks_obtained?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: 'max_marks must be a number' })
  @IsPositive({ message: 'max_marks must be a positive number' })
  max_marks?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'entered_by_faculty_id must be an integer' })
  @IsPositive({ message: 'entered_by_faculty_id must be a positive integer' })
  entered_by_faculty_id?: number;
}
