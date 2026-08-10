import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export const HOSTEL_FEE_YEAR_CODES = [
  'ug1',
  'ug2',
  'ug3',
  'ug4',
  'pg1',
  'pg2',
] as const;
export type HostelFeeYearCode = (typeof HOSTEL_FEE_YEAR_CODES)[number];

export class SearchHostelFeesDto {
  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  hostel_id?: number;

  @IsOptional()
  @IsIn(['boys', 'girls'])
  wing?: 'boys' | 'girls';

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  block_id?: number;

  @IsOptional()
  @IsIn(HOSTEL_FEE_YEAR_CODES)
  year?: HostelFeeYearCode;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsIn(['unpaid', 'partially_paid', 'paid'])
  status?: 'unpaid' | 'partially_paid' | 'paid';

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  @Max(100)
  page_size?: number = 20;
}
