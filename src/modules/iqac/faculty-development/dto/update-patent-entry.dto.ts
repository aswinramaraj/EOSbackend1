import {
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  MaxLength,
  Max,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

const STAGES = ['filed', 'published', 'granted'] as const;

/**
 * faculty_id can't be reassigned here — delete + re-add for that. role edits
 * the real inventorship row; title/stage/filed_year/stage_date edit the
 * shared patent row itself (visible to every other inventor too), which is
 * exactly the "Filed → Granted" progression this metric needs to track.
 */
export class UpdatePatentEntryDto {
  @IsOptional()
  @IsString()
  @MaxLength(30)
  role?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  title?: string;

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
}
