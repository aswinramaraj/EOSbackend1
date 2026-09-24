import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ResearchContributorDto } from './research-contributor.dto';

/**
 * The redesigned "Add entry" modal for Research: project title first, then
 * focus area, then one shared joined-on date, then a repeatable
 * faculty-or-student contributor list (each tagged Principal Investigator /
 * Co-Investigator / Team Member) instead of a single faculty + role. Finds
 * an existing real research_projects row by exact centre_name or
 * creates one (focus_area only used on create) — same convention as before,
 * now inserting one membership row per submitted contributor.
 */
export class AddResearchEntryDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  centre_name: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  focus_area?: string;

  @IsOptional()
  @IsDateString()
  joined_on?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ResearchContributorDto)
  contributors: ResearchContributorDto[];
}
