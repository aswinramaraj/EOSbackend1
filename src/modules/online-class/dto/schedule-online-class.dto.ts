import { Type } from 'class-transformer';
import { IsInt, IsISO8601, IsOptional, IsString, MaxLength } from 'class-validator';

/** POST /online-classes/schedule */
export class ScheduleOnlineClassDto {
  @Type(() => Number)
  @IsInt()
  subject_id: number;

  @Type(() => Number)
  @IsInt()
  class_id: number;

  @IsISO8601()
  scheduled_at: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;
}
