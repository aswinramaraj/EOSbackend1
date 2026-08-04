import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { HostelComplaintPriority } from './create-complaint.dto';

export enum HostelComplaintStatus {
  open = 'open',
  in_progress = 'in_progress',
  resolved = 'resolved',
  escalated = 'escalated',
}

export class UpdateComplaintDto {
  @IsOptional()
  @IsEnum(HostelComplaintStatus)
  status?: HostelComplaintStatus;

  @IsOptional()
  @IsEnum(HostelComplaintPriority)
  priority?: HostelComplaintPriority;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  assigned_to?: string;

  @IsOptional()
  @IsString()
  resolution_note?: string;
}
