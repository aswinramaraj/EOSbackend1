import { IsIn, IsOptional } from 'class-validator';
import { PaginationDto } from 'src/common/dto/pagination.dto';

/**
 * GET /me/product-requests — filters, layered on the project's shared
 * pagination convention. The reviewer role sees every request; every other
 * allowed role is force-scoped to their own submissions (see
 * ProductRequestsService.findAll).
 */
export class ListProductRequestQueryDto extends PaginationDto {
  @IsOptional()
  @IsIn(['draft', 'pending', 'approved', 'rejected'])
  status?: 'draft' | 'pending' | 'approved' | 'rejected';
}
