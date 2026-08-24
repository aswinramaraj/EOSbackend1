import {
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
} from 'class-validator';

/**
 * The reference design's "Add faculty entry" popup for Research — real
 * faculty_research_projects/faculty_research_project_members rows.
 * centre_name finds an existing real project by that exact name or creates
 * one (focus_area is only used on create); this call always inserts a real
 * membership row for the given faculty.
 */
export class AddResearchEntryDto {
  @IsInt()
  @IsPositive()
  faculty_id: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  centre_name: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  focus_area?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  role: string;

  @IsOptional()
  @IsDateString()
  joined_on?: string;
}
