import { IsIn, IsOptional } from 'class-validator';

export class QueryHodDashboardDto {
  @IsOptional()
  @IsIn(['today', 'term'])
  scope?: 'today' | 'term';
}
