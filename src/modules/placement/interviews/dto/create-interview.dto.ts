import {
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsPositive,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreateInterviewDto {
  @IsInt()
  @IsPositive()
  student_id: number;

  @IsInt()
  @IsPositive()
  drive_id: number;

  @IsDateString()
  interview_date: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  round_label: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  slot_label: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  panel_member: string;
}
