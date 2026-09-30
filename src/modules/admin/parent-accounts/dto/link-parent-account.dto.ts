import { IsIn, IsInt } from 'class-validator';

const RELATIONSHIPS = ['father', 'mother', 'guardian'] as const;

/** POST /students/:id/parents/link (Admin). Links an already-existing parent login to another child (e.g. a sibling), instead of creating a new one. */
export class LinkParentAccountDto {
  @IsInt()
  parent_user_id: number;

  @IsIn(RELATIONSHIPS, { message: 'relationship must be father, mother, or guardian' })
  relationship: (typeof RELATIONSHIPS)[number];
}
