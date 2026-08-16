import { IsBoolean, IsOptional } from 'class-validator';

export class UpdateSettingsDto {
  @IsOptional()
  @IsBoolean()
  daily_attendance_digest?: boolean;

  @IsOptional()
  @IsBoolean()
  sop_escalation_alerts?: boolean;

  @IsOptional()
  @IsBoolean()
  auto_circulate_mom?: boolean;

  @IsOptional()
  @IsBoolean()
  compact_tables?: boolean;
}
