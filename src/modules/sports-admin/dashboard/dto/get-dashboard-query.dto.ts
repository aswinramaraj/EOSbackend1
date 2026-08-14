import { IsIn, IsOptional } from 'class-validator';

const TIMEFRAMES = ['today', 'term', 'year'] as const;
export type DashboardTimeframe = (typeof TIMEFRAMES)[number];

/** GET /sports-admin/dashboard?timeframe= — defaults to 'today' when omitted. */
export class GetDashboardQueryDto {
  @IsOptional()
  @IsIn(TIMEFRAMES, {
    message: `timeframe must be one of ${TIMEFRAMES.join(', ')}`,
  })
  timeframe?: DashboardTimeframe;
}
