import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  exam_session_enum,
  malpractice_action_enum,
  malpractice_nature_enum,
} from 'generated/prisma/client';

export class CreateMalpracticeDto {
  @IsInt()
  @IsPositive()
  @Type(() => Number)
  student_id!: number;

  @IsInt()
  @IsPositive()
  @Type(() => Number)
  exam_id!: number;

  @IsOptional()
  @IsInt()
  @IsPositive()
  @Type(() => Number)
  exam_subject_mapping_id?: number;

  @IsOptional()
  @IsInt()
  @IsPositive()
  @Type(() => Number)
  venue_id?: number;

  @IsDateString()
  incident_date!: string;

  @IsEnum(exam_session_enum, {
    message: `session must be one of: ${Object.values(exam_session_enum).join(', ')}`,
  })
  session!: exam_session_enum;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  seat_number?: string;

  @IsEnum(malpractice_nature_enum, {
    message: `nature must be one of: ${Object.values(malpractice_nature_enum).join(', ')}`,
  })
  nature!: malpractice_nature_enum;

  @IsEnum(malpractice_action_enum, {
    message: `action_taken must be one of: ${Object.values(malpractice_action_enum).join(', ')}`,
  })
  action_taken!: malpractice_action_enum;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  invigilator_remarks?: string;

  @IsOptional()
  @IsInt()
  @IsPositive()
  @Type(() => Number)
  reported_by_faculty_id?: number;
}
