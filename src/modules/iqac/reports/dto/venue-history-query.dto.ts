import { IsISO8601 } from 'class-validator';

/** GET /iqac/reports/venue-history?date= (IQAC only). */
export class VenueHistoryQueryDto {
  @IsISO8601({}, { message: 'date must be a valid ISO date' })
  date: string;
}
