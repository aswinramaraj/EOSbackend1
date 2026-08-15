import { IsDateString, IsOptional, IsString, MaxLength } from 'class-validator';

export class RescheduleInterviewDto {
  @IsOptional()
  @IsDateString()
  interview_date?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  round_label?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  slot_label?: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  panel_member?: string;
}
