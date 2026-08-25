import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString } from 'class-validator';

export class ListPrincipalFacultyQueryDto {
  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  department_id?: number;

  /** Defaults to 'active' (the Principal page's original, unchanged behaviour) when omitted — 'all'/'inactive' are opt-in for callers (e.g. IQAC's Status filter) that actually want to see inactive faculty too. */
  @IsOptional()
  @IsIn(['active', 'inactive', 'all'])
  status?: 'active' | 'inactive' | 'all';
}
