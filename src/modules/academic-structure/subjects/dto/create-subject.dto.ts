// subjects/dto/create-subject.dto.ts
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';

export class CreateSubjectDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty({ message: 'Subject name is required' })
  @MaxLength(150, { message: 'Subject name must not exceed 150 characters' })
  name: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty({ message: 'Subject code is required' })
  @MaxLength(30, { message: 'Subject code must not exceed 30 characters' })
  subject_code: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'department_id must be an integer' })
  @IsPositive({ message: 'department_id must be a positive integer' })
  department_id?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'credits must be an integer' })
  @IsPositive({ message: 'credits must be a positive integer' })
  credits?: number;
}
