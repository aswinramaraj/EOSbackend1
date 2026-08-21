import { IsDateString, IsEnum, IsInt, IsOptional, IsString, MaxLength } from 'class-validator';

export enum ShootAssignmentStatus {
  PLANNED = 'planned',
  CONFIRMED = 'confirmed',
  DELIVERED = 'delivered',
  CANCELLED = 'cancelled',
}

export class UpdateShootAssignmentDto {
  @IsOptional()
  @IsInt()
  assigned_to_member_id?: number;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  crew?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  gear_issued?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  output_type?: string;

  @IsOptional()
  @IsDateString()
  scheduled_at?: string;

  @IsOptional()
  @IsEnum(ShootAssignmentStatus)
  status?: ShootAssignmentStatus;
}
