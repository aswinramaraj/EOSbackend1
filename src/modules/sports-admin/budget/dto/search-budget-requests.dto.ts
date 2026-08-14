import { IsIn, IsOptional } from 'class-validator';
import { approval_status_enum } from 'generated/prisma/client';

const VALID_STATUSES = Object.values(approval_status_enum);

/** GET /sports-admin/budget-requests?status= */
export class SearchBudgetRequestsDto {
  @IsOptional()
  @IsIn(VALID_STATUSES, {
    message: `status must be a valid budget request status value (${VALID_STATUSES.join(', ')})`,
  })
  status?: approval_status_enum;
}
