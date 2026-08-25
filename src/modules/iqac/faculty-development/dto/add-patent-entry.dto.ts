import {
  IsIn,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
  Max,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

const STAGES = ['filed', 'published', 'granted'] as const;

/**
 * The reference design's "Add faculty entry" popup for Patents — real
 * faculty_patents/faculty_patent_inventors rows. title finds an existing
 * real patent by that exact name or creates one (stage/filed_year/
 * stage_date only used on create); this call always inserts a real
 * inventorship row for the given faculty.
 */
export class AddPatentEntryDto {
  @IsInt()
  @IsPositive()
  faculty_id: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  title: string;

  @IsOptional()
  @IsIn(STAGES)
  stage?: (typeof STAGES)[number];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1900)
  @Max(2100)
  filed_year?: number;

  @IsOptional()
  @IsISO8601()
  stage_date?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  role: string;
}
