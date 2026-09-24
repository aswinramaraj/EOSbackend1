import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateHrPayrollRequestDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  category: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  subject: string;

  @IsOptional()
  @IsString()
  description?: string;

  /** Real column, previously never read/written by this service — from POST /announcements/attachments (media_room is already permitted there). */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  attachment_url?: string;
}
