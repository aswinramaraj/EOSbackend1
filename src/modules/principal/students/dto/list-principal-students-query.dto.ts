import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

export const PRINCIPAL_STUDENT_FILTERS = [
  'all',
  'attendance_below_75',
  'fees_pending',
  'cgpa_above_85',
  'cgpa_below_7',
  'has_arrears',
] as const;
export type PrincipalStudentFilter = (typeof PRINCIPAL_STUDENT_FILTERS)[number];

export class ListPrincipalStudentsQueryDto {
  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  batch_id?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  department_id?: number;

  @IsOptional()
  @IsString()
  section?: string;

  @IsOptional()
  @IsIn(PRINCIPAL_STUDENT_FILTERS)
  filter?: PrincipalStudentFilter;

  /** Defaults to 'active' (the Principal page's original, unchanged behaviour) when omitted — 'all'/'inactive' are opt-in for callers (e.g. IQAC's Status filter) that actually want to see inactive students too. */
  @IsOptional()
  @IsIn(['active', 'inactive', 'all'])
  status?: 'active' | 'inactive' | 'all';

  /** 1-based. Defaults to 1. Pagination is applied after every filter above, over the batch-wise ordered result (see list()'s sort). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  /** Defaults to 15 (one register "page" of students). Capped at 100 to keep the in-memory compute bounded. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
