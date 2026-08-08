import { IsOptional, IsString, Matches } from 'class-validator';

export class QueryAttendanceDto {
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}$/, { message: 'academic_year must look like 2026-27' })
  academic_year?: string;
}
