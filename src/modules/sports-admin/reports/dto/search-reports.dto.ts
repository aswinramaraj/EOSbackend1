import { IsIn, IsOptional } from 'class-validator';
import { sports_report_status_enum } from 'generated/prisma/client';

const VALID_STATUSES = Object.values(sports_report_status_enum);

/** GET /sports-admin/reports?status= */
export class SearchReportsDto {
  @IsOptional()
  @IsIn(VALID_STATUSES, {
    message: `status must be a valid report status value (${VALID_STATUSES.join(', ')})`,
  })
  status?: sports_report_status_enum;
}
