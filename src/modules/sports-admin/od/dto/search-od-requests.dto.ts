import { IsIn, IsOptional } from 'class-validator';
import { approval_status_enum } from 'generated/prisma/client';

const VALID_STATUSES = Object.values(approval_status_enum);

/** GET /sports-admin/od-requests?status= */
export class SearchOdRequestsDto {
  @IsOptional()
  @IsIn(VALID_STATUSES, {
    message: `status must be a valid OD request status value (${VALID_STATUSES.join(', ')})`,
  })
  status?: approval_status_enum;
}
