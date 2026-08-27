import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

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

  /** 1-based. Defaults to 1. Pagination is applied after every filter above, over the department-wise ordered result (see list()'s sort). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  /** Defaults to 15 (one register "page" of faculty). Capped at 100 to keep the in-memory compute bounded. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
