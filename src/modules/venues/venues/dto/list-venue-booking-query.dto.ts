import { Type } from 'class-transformer';
import { IsIn, IsInt, IsISO8601, IsOptional, IsString } from 'class-validator';
import { PaginationDto } from 'src/common/dto/pagination.dto';

/**
 * GET /venue-bookings — filters, layered on the project's shared pagination
 * convention. IQAC sees every booking; every other allowed role is
 * force-scoped to their own submissions (see VenuesService.findAllBookings).
 * search/department_id/date are IQAC admin-portal filters (faculty name
 * search, department, booking date) — meaningless for the own-only roles,
 * who are already scoped down to a handful of their own rows.
 */
export class ListVenueBookingQueryDto extends PaginationDto {
  @IsOptional()
  @IsIn(['pending', 'approved', 'rejected', 'alternative_offered'])
  status?: 'pending' | 'approved' | 'rejected' | 'alternative_offered';

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  department_id?: number;

  @IsOptional()
  @IsISO8601({}, { message: 'date must be a valid ISO date' })
  date?: string;
}
