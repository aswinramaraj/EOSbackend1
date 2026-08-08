import { IsIn, IsOptional } from 'class-validator';
import { PaginationDto } from 'src/common/dto/pagination.dto';

/** GET /me/od-hod-approvals (HoD only) — defaults to the HoD's pending queue. */
export class ListOdHodApprovalQueryDto extends PaginationDto {
  @IsOptional()
  @IsIn(['pending', 'approved', 'rejected'])
  status?: 'pending' | 'approved' | 'rejected';
}
