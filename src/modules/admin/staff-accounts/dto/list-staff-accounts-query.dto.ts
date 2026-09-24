import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationDto } from 'src/common/dto/pagination.dto';
import {
  PROVISIONABLE_STAFF_ROLES,
  ProvisionableStaffRole,
} from '../constants/provisionable-roles.constant';

/** GET /staff-accounts — query filters, layered on the project's shared pagination convention. */
export class ListStaffAccountsQueryDto extends PaginationDto {
  @IsOptional()
  @IsIn(PROVISIONABLE_STAFF_ROLES)
  role_name?: ProvisionableStaffRole;

  @IsOptional()
  @IsIn(['active', 'inactive'])
  status?: 'active' | 'inactive';

  /** Matches against the login email (and, for Secretary, first/last name) — case-insensitive substring. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}
