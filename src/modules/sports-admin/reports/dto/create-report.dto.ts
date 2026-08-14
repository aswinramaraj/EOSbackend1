import { IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { sports_report_status_enum } from 'generated/prisma/client';

const VALID_STATUSES = Object.values(sports_report_status_enum);

/** POST /sports-admin/reports (Sports Admin/Admin only). */
export class CreateReportDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  period_label?: string;

  @IsOptional()
  @IsIn(VALID_STATUSES, {
    message: `status must be a valid report status value (${VALID_STATUSES.join(', ')})`,
  })
  status?: sports_report_status_enum;
}
