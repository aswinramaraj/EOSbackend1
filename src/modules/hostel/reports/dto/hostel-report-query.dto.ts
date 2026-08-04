import { Transform } from 'class-transformer';
import { IsDateString, IsEnum, IsInt, IsOptional, Min } from 'class-validator';

export enum HostelReportFormat {
  json = 'json',
  excel = 'excel',
  pdf = 'pdf',
}

export class HostelReportQueryDto {
  @IsOptional()
  @IsEnum(HostelReportFormat)
  format?: HostelReportFormat = HostelReportFormat.json;

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  hostel_id?: number;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}
