import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsPositive } from 'class-validator';

export enum ExamReportFormat {
  json = 'json',
  excel = 'excel',
  pdf = 'pdf',
  csv = 'csv',
}

export class ExamReportQueryDto {
  @IsOptional()
  @IsEnum(ExamReportFormat)
  format?: ExamReportFormat = ExamReportFormat.json;

  @Type(() => Number)
  @IsInt({ message: 'exam_id must be an integer' })
  @IsPositive({ message: 'exam_id must be a positive integer' })
  exam_id!: number;
}
