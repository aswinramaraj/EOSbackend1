import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsISO8601, IsOptional } from 'class-validator';

export enum IqacReportFormat {
  json = 'json',
  excel = 'excel',
  pdf = 'pdf',
}

/** GET /iqac/reports/venue-bookings|student-ods|faculty-ods (IQAC only). */
export class IqacReportQueryDto {
  @IsOptional()
  @IsEnum(IqacReportFormat)
  format?: IqacReportFormat = IqacReportFormat.json;

  @IsOptional()
  @IsISO8601({}, { message: 'from must be a valid ISO date' })
  from?: string;

  @IsOptional()
  @IsISO8601({}, { message: 'to must be a valid ISO date' })
  to?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  department_id?: number;
}
