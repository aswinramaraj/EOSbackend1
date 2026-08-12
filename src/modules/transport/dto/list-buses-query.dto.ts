import { IsIn, IsOptional, IsString } from 'class-validator';

export type BusStatusFilter = 'on_route' | 'at_campus' | 'in_depot' | 'maintenance';

/** GET /me/buses?status=&search= */
export class ListBusesQueryDto {
  @IsOptional()
  @IsIn(['on_route', 'at_campus', 'in_depot', 'maintenance'])
  status?: BusStatusFilter;

  @IsOptional()
  @IsString()
  search?: string;
}
