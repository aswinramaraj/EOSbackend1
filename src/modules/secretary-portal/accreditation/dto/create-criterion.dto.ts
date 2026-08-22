import { Type } from 'class-transformer';
import { IsInt, IsNotEmpty, IsPositive, IsString, MaxLength, Min } from 'class-validator';

export class CreateCriterionDto {
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  department_id: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  code: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  max_marks: number;
}
