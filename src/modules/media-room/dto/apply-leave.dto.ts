import { IsBoolean, IsDateString, IsInt, IsOptional, IsString, MaxLength } from 'class-validator';

export class ApplyLeaveDto {
  @IsDateString()
  from_date: string;

  @IsDateString()
  to_date: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;

  @IsOptional()
  @IsInt()
  leave_type_id?: number;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  alternate_arrangement?: string;

  @IsOptional()
  @IsBoolean()
  is_station_leave?: boolean;

  /** Real column, previously never read/written by this service — from POST /announcements/attachments (media_room is already permitted there). */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  attachment_url?: string;
}
