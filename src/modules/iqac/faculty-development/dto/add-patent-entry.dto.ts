import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsISO8601,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PatentContributorDto } from './patent-contributor.dto';

const STAGES = ['filed', 'published', 'granted'] as const;

/**
 * The redesigned "Add entry" modal for Patents: patent title first, then
 * Stage/Filed year/Stage date, then a repeatable faculty-or-student
 * contributor list (each tagged Inventor / Co-inventor) instead of a single
 * faculty + role. Finds an existing real patents row by exact title
 * or creates one (stage/filed_year/stage_date only used on create) — same
 * convention as before, now inserting one inventorship row per submitted
 * contributor.
 */
export class AddPatentEntryDto {
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

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PatentContributorDto)
  contributors: PatentContributorDto[];
}
