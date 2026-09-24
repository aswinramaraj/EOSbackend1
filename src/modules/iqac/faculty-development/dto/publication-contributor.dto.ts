import { IsIn, IsInt, IsPositive } from 'class-validator';

export const CONTRIBUTOR_TYPES = ['faculty', 'student'] as const;
export const CONTRIBUTOR_ROLES = ['primary_author', 'secondary_author'] as const;

/** One row of the "search faculty or student, tag Primary/Secondary" picker on the Add/Edit Publication modal. */
export class PublicationContributorDto {
  @IsIn(CONTRIBUTOR_TYPES)
  type: (typeof CONTRIBUTOR_TYPES)[number];

  @IsInt()
  @IsPositive()
  id: number;

  @IsIn(CONTRIBUTOR_ROLES)
  role: (typeof CONTRIBUTOR_ROLES)[number];
}
