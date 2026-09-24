import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PublicationContributorDto } from './publication-contributor.dto';

const STATUSES = ['published', 'accepted', 'under_review', 'submitted'] as const;

/**
 * The redesigned "Add publication entry" modal: title first, then venue/
 * indexing/date, then a repeatable faculty-or-student contributor list
 * (each tagged Primary/Secondary author) instead of a single faculty +
 * 3-option author-role dropdown. Requires
 * `research_development_rename.query.md` Steps 1-3 to have been run — see
 * IqacFacultyDevelopmentService.addPublicationEntry() for the guarded
 * fallback that surfaces a clear error otherwise.
 */
export class AddPublicationEntryDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  title: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  venue?: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  indexing?: string;

  @IsOptional()
  @IsDateString()
  published_date?: string;

  @IsOptional()
  @IsIn(STATUSES)
  status?: (typeof STATUSES)[number];

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PublicationContributorDto)
  contributors: PublicationContributorDto[];
}
