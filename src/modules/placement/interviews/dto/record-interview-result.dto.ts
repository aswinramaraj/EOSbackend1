import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { drive_application_status_enum } from '../../../../../generated/prisma/enums';

export class RecordInterviewResultDto {
  @IsEnum(drive_application_status_enum)
  result: drive_application_status_enum;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  panel_feedback?: string;
}
