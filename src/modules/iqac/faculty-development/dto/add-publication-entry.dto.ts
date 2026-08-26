import {
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
} from 'class-validator';

const AUTHOR_ROLES = ['first_author', 'co_author', 'corresponding_author'] as const;
const STATUSES = ['published', 'accepted', 'under_review', 'submitted'] as const;

/**
 * The reference design's "Add faculty entry" popup for Publications.
 * title/type aren't shown in the mock but are real NOT NULL columns on
 * faculty_publications — title is added back here (the page's own venue
 * drilldown displays it, so a paper with no title would be unidentifiable);
 * type defaults to 'journal' since this popup's own "Journal / venue"
 * field implies that's the intended kind. author_role/indexing/status are
 * real once the additive columns below exist — see
 * IqacFacultyDevelopmentService.addPublicationEntry() for the guarded
 * raw-query fallback.
 *
 * ALTER TABLE faculty_publications ADD COLUMN IF NOT EXISTS author_role VARCHAR(30);
 * ALTER TABLE faculty_publications ADD COLUMN IF NOT EXISTS indexing VARCHAR(150);
 * ALTER TABLE faculty_publications ADD COLUMN IF NOT EXISTS published_date DATE;
 * ALTER TABLE faculty_publications ADD COLUMN IF NOT EXISTS status VARCHAR(20);
 */
export class AddPublicationEntryDto {
  @IsInt()
  @IsPositive()
  faculty_id: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  title: string;

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
}
