import { IsIn, IsOptional } from 'class-validator';
import { PaginationDto } from 'src/common/dto/pagination.dto';

/** GET /me/service-requests — mirrors ListPurchaseRequestsQueryDto exactly. */
export class ListServiceRequestsQueryDto extends PaginationDto {
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
