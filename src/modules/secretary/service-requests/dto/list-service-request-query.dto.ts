import { IsIn, IsOptional } from 'class-validator';
import { PaginationDto } from 'src/common/dto/pagination.dto';

/**
 * GET /me/service-requests — filters, layered on the project's shared
 * pagination convention. The reviewer role sees every request; every other
 * allowed role is force-scoped to their own submissions (see
 * ServiceRequestsService.findAll).
 */
export class ListServiceRequestQueryDto extends PaginationDto {
  @IsOptional()
  @IsIn(['draft', 'pending', 'approved', 'rejected'])
  status?: 'draft' | 'pending' | 'approved' | 'rejected';
}
