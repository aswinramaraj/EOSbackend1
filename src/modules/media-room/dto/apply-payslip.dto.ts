import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export class ApplyPayslipDto {
  @Matches(/^\d{4}-\d{2}$/, { message: 'month must be in YYYY-MM format' })
  month: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  purpose?: string;
}
