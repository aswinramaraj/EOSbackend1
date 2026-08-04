import {
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  Max,
  Min,
} from 'class-validator';

export class UpdateHostelSettingsDto {
  @IsOptional()
  @IsBoolean()
  auto_approve_low_risk?: boolean;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  min_attendance_for_auto_pct?: number;

  @IsOptional()
  @IsBoolean()
  require_biometric_pop?: boolean;

  @IsOptional()
  @IsBoolean()
  sms_guardian_on_checkout?: boolean;

  @IsOptional()
  @IsBoolean()
  alert_on_overdue_return?: boolean;

  @IsOptional()
  @IsBoolean()
  weekly_arrears_reminder?: boolean;

  @IsOptional()
  @IsBoolean()
  publish_resolved_complaints?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  max_outing_days?: number;
}
