import { IsDateString, IsIn, IsInt, IsNumber, IsOptional, IsString, Max, Min, MaxLength } from 'class-validator';

export const EDC_FUNDING_SOURCE_CATEGORIES = ['College grant', 'Competition prize', 'External investment', 'Government grant'] as const;
export const EDC_FUNDING_STATUSES = ['Verified', 'In Progress', 'Pending'] as const;

export class CreateFundingRecordDto {
  @IsInt()
  student_entrepreneurship_id: number;

  @IsIn(EDC_FUNDING_SOURCE_CATEGORIES)
  source_category: (typeof EDC_FUNDING_SOURCE_CATEGORIES)[number];

  @IsOptional()
  @IsString()
  @MaxLength(200)
  source_detail?: string;

  @IsNumber()
  amount: number;

  @IsDateString()
  disbursed_date: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  utilisation_pct?: number;

  @IsOptional()
  @IsIn(EDC_FUNDING_STATUSES)
  status?: (typeof EDC_FUNDING_STATUSES)[number];
}
