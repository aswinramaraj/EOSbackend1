import { Type } from 'class-transformer';
import { IsIn, IsNotEmpty, IsNumber, IsOptional, IsString, Min, MaxLength } from 'class-validator';

const STAGES = ['interested', 'applied', 'admitted', 'enrolled'] as const;

/** POST /me/higher-education-aspirants — identifies the student by register number; preferred_course/preferred_country are NOT NULL on student_higher_education. */
export class CreateAspirantDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  register_no!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  programme!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  country!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  university?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  intake?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  cgpa?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  percentage?: number;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  test_scores_summary?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  scholarship_name?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  scholarship_value?: number;

  @IsOptional()
  @IsIn(STAGES)
  stage?: (typeof STAGES)[number];
}
