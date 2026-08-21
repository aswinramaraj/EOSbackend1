import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

export enum ReportFormat {
  json = 'json',
  excel = 'excel',
  pdf = 'pdf',
}

export class GenerateReportQueryDto {
  @IsOptional()
  @IsEnum(ReportFormat)
  format?: ReportFormat = ReportFormat.json;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  period?: string;
}
