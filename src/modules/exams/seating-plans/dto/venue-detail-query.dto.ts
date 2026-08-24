import { Type } from 'class-transformer';
import { IsInt, IsPositive } from 'class-validator';
import { OverviewQueryDto } from './overview-query.dto';

export class VenueDetailQueryDto extends OverviewQueryDto {
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  venue_id!: number;
}
