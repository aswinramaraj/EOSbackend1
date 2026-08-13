import { IsIn, IsInt, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Review/decision fields — this is the EDC Coordinator's "review" action
 * (Under Review -> Selected/Approved/Rejected), not a general content edit.
 * `reviewer_user_id` is set server-side from the caller, never accepted here.
 */
export class UpdateStartupIdeaDto {
  @IsOptional()
  @IsIn(['Under Review', 'Selected', 'Approved', 'Rejected'])
  review_status?: 'Under Review' | 'Selected' | 'Approved' | 'Rejected';

  @IsOptional()
  @IsString()
  reviewer_note?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  conversion_note?: string;

  @IsOptional()
  @IsInt()
  converted_venture_id?: number;

  @IsOptional()
  @IsInt()
  mentor_faculty_id?: number;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  target_milestone?: string;
}
