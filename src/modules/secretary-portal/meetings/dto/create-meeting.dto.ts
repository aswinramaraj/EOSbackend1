import { Type } from 'class-transformer';
import { IsDateString, IsInt, IsNotEmpty, IsOptional, IsPositive, IsString, MaxLength, Min } from 'class-validator';

export class CreateMeetingDto {
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  department_id: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  title: string;

  @IsDateString()
  meeting_at: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  venue?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  chair_user_id?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  invitee_count?: number;
}
