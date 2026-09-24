import { IsIn, IsInt, IsPositive } from 'class-validator';

export const CONTRIBUTOR_TYPES = ['faculty', 'student'] as const;
export const RESEARCH_ROLES = ['Principal Investigator', 'Co-Investigator', 'Team Member'] as const;

/** One row of the "search faculty or student, tag their role" picker on the Add/Edit Research modal. */
export class ResearchContributorDto {
  @IsIn(CONTRIBUTOR_TYPES)
  type: (typeof CONTRIBUTOR_TYPES)[number];

  @IsInt()
  @IsPositive()
  id: number;

  @IsIn(RESEARCH_ROLES)
  role: (typeof RESEARCH_ROLES)[number];
}
