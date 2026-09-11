// Shared `students.career_path` value set — staff-set on the Placement
// Students page (see placement/drives/dto/update-student-career-path.dto.ts,
// the actual validated DTO), read-only from the student's own /me/career-path.
export const CAREER_PATH_VALUES = [
  'placement',
  'venture',
  'higher_studies',
] as const;
export type CareerPath = (typeof CAREER_PATH_VALUES)[number];
