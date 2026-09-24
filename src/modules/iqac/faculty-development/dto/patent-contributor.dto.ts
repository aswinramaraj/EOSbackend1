import { IsIn, IsInt, IsPositive } from 'class-validator';

export const CONTRIBUTOR_TYPES = ['faculty', 'student'] as const;
export const PATENT_ROLES = ['Inventor', 'Co-inventor'] as const;

/** One row of the "search faculty or student, tag their role" picker on the Add/Edit Patent modal. */
export class PatentContributorDto {
  @IsIn(CONTRIBUTOR_TYPES)
  type: (typeof CONTRIBUTOR_TYPES)[number];

  @IsInt()
  @IsPositive()
  id: number;

  @IsIn(PATENT_ROLES)
  role: (typeof PATENT_ROLES)[number];
}
