import { IsDateString, IsOptional } from 'class-validator';

export class ListPersonalCalendarEntriesQueryDto {
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}
