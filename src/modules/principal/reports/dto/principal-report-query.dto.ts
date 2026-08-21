import { IsEnum, IsOptional } from 'class-validator';

export enum PrincipalReportFormat {
  json = 'json',
  excel = 'excel',
  pdf = 'pdf',
}

export class PrincipalReportQueryDto {
  @IsOptional()
  @IsEnum(PrincipalReportFormat)
  format?: PrincipalReportFormat = PrincipalReportFormat.json;
}
