import { IsBoolean, IsDateString, IsIn, IsInt, IsNotEmpty, IsNumber, IsOptional, IsPositive, IsString, Min, MaxLength } from 'class-validator';

export const INDENT_TYPES = ['capital_equipment', 'consumables', 'repair_service', 'rental_hire'] as const;
export const BUDGET_HEADS = ['media_branding', 'institution_events', 'admissions_outreach'] as const;

export class CreateIndentDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title: string;

  @IsOptional()
  @IsIn(INDENT_TYPES)
  indent_type?: string;

  @IsOptional()
  @IsInt()
  @IsPositive()
  quantity?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  estimated_cost?: number;

  @IsOptional()
  @IsDateString()
  needed_by?: string;

  @IsOptional()
  @IsIn(BUDGET_HEADS)
  budget_head?: string;

  @IsOptional()
  @IsString()
  justification?: string;

  /** The design's "Save draft" button — a draft never reaches the approval queue until later submitted (PATCH status: 'pending'). */
  @IsOptional()
  @IsBoolean()
  save_as_draft?: boolean;
}
