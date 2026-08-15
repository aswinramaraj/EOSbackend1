import {
  ArrayNotEmpty,
  IsArray,
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

/** POST /sports-admin/od-requests (Sports Admin/Admin only). */
export class CreateOdRequestDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  od_type: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  periods_affected?: string;

  @IsDateString()
  from_date: string;

  @IsDateString()
  to_date: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  event: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  venue?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  level?: string;

  @IsOptional()
  @IsInt()
  accompanying_coach_faculty_id?: number;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  transport?: string;

  @IsOptional()
  @IsString()
  remarks?: string;

  @IsArray()
  @ArrayNotEmpty()
  @IsInt({ each: true })
  student_ids: number[];
}
