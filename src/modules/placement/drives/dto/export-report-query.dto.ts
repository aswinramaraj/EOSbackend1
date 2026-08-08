import { IsIn, IsInt, IsOptional, IsPositive, IsString } from 'class-validator';
import { Type } from 'class-transformer';

export class ExportReportQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  batch_id?: number;

  @IsOptional()
  @IsIn(['class', 'department'])
  view?: 'class' | 'department';

  @IsOptional()
  @IsIn(['pdf', 'excel'])
  format?: 'pdf' | 'excel';

  /** Scopes a class-wise export to one department's classes (the Reports page's drill-down). */
  @IsOptional()
  @IsString()
  department?: string;
}

export class ExportStudentReportQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  batch_id?: number;

  /** Scopes the export to one class — matches the Student Reports page's own class filter. */
  @IsOptional()
  @IsString()
  class?: string;

  @IsOptional()
  @IsIn(['pdf', 'excel'])
  format?: 'pdf' | 'excel';
}
