import { IsIn, IsOptional } from 'class-validator';

export type TransportDashboardPeriod = 'today' | 'term' | 'year';

/** GET /me/transport-dashboard?period= — scopes the date-bound figures (diesel, fee collected, buses reporting). */
export class GetTransportDashboardQueryDto {
  @IsOptional()
  @IsIn(['today', 'term', 'year'])
  period?: TransportDashboardPeriod;
}
