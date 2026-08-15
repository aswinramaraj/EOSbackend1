import { IsISO8601, IsOptional, IsString } from 'class-validator';
import { PaginationDto } from 'src/common/dto/pagination.dto';

/**
 * GET /venues?from=...&to=...&search=...&page=...&limit=... — availability check.
 *
 * `from`/`to` are required (this endpoint's whole purpose is checking
 * availability for a window), so neither is @IsOptional(). Cross-field
 * validation (from must be before to) can't be expressed per-field and is
 * done in the service, same as the venue-bookings date checks. `search`
 * follows the same convention as ListCompaniesQueryDto (name, contains,
 * case-insensitive).
 */
export class ListVenueQueryDto extends PaginationDto {
  @IsISO8601({}, { message: 'from must be a valid ISO date-time' })
  from: string;

  @IsISO8601({}, { message: 'to must be a valid ISO date-time' })
  to: string;

  @IsOptional()
  @IsString()
  search?: string;
}
