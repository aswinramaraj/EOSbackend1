import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export enum HostelComplaintCategory {
  plumbing = 'plumbing',
  electrical = 'electrical',
  carpentry = 'carpentry',
  network = 'network',
  mess = 'mess',
  facilities = 'facilities',
  other = 'other',
}

export enum HostelComplaintPriority {
  low = 'low',
  medium = 'medium',
  high = 'high',
}

// Raised by staff on a resident's behalf — a self-service student endpoint
// (analogous to /me/hostel-outings) is a reasonable future addition but out
// of scope for the warden console itself.
export class CreateComplaintDto {
  @IsInt()
  student_id: number;

  @IsOptional()
  @IsInt()
  hostel_id?: number;

  @IsEnum(HostelComplaintCategory)
  category: HostelComplaintCategory;

  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  title: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsEnum(HostelComplaintPriority)
  priority?: HostelComplaintPriority;
}
