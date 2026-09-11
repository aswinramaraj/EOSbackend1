import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Min,
  MaxLength,
} from 'class-validator';

const AUTHOR_ROLES = [
  'first_author',
  'co_author',
  'corresponding_author',
] as const;
const STATUSES = [
  'published',
  'accepted',
  'under_review',
  'submitted',
] as const;

/** faculty_id can't be reassigned here — delete + re-add for that, same convention as UpdateAchievementDto. */
export class UpdatePublicationEntryDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  venue?: string;

  @IsOptional()
  @IsIn(AUTHOR_ROLES)
  author_role?: (typeof AUTHOR_ROLES)[number];

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

  @IsOptional()
  @IsInt()
  @Min(0)
  citation_count?: number;
}
