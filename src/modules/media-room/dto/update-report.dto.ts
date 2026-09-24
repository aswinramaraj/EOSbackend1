import { IsEnum } from 'class-validator';

export enum ReportStatus {
  DRAFT = 'draft',
  FINAL = 'final',
}

export class UpdateReportDto {
  @IsEnum(ReportStatus)
  status: ReportStatus;
}
