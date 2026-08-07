import { IsIn, IsOptional } from 'class-validator';
import { PaginationDto } from 'src/common/dto/pagination.dto';

/**
 * GET /me/purchase-requests — the caller's own view of the workflow, scoped
 * per role in the service (Secretary: own submissions; HoD: own
 * department's; Finance/Admin: institution-wide). `status` here is the
 * derived, unified status (see PurchaseRequestsService.deriveStatus) - not
 * a raw column - so filtering happens in application code after the
 * underlying rows are fetched.
 */
export class ListPurchaseRequestsQueryDto extends PaginationDto {
  @IsOptional()
  @IsIn([
    'pending_hod',
    'pending_finance',
    'approved',
    'rejected_by_hod',
    'rejected_by_finance',
    'converted',
  ])
  status?: string;
}
