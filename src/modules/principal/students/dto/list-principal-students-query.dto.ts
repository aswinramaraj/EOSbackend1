import { IsIn, IsInt, IsOptional, IsString } from 'class-validator';
import { Type } from 'class-transformer';

export const PRINCIPAL_STUDENT_FILTERS = [
  'all',
  'attendance_below_75',
  'fees_pending',
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
}
