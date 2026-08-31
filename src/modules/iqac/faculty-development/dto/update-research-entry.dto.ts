import {
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

const PROJECT_STATUSES = ['ongoing', 'completed'] as const;

/**
 * faculty_id/centre_name can't be reassigned here (that means moving to a
 * different real project — delete + re-add for that). role/joined_on edit
 * the real membership row; focus_area/status edit the shared project row
 * itself (visible to every other member too, same as the patent's
 * stage/filed_year below).
 */
export class UpdateResearchEntryDto {
  @IsOptional()
  @IsString()
  @MaxLength(50)
  role?: string;

  @IsOptional()
  @IsDateString()
  joined_on?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  focus_area?: string;

  @IsOptional()
  @IsIn(PROJECT_STATUSES)
  status?: (typeof PROJECT_STATUSES)[number];
}
