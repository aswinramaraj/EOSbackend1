import type { grade_bands } from 'generated/prisma/client';

export interface GradeLookupResult {
  label: string;
  point: number | null;
  isPass: boolean;
}

type GradeBandRow = Pick<
  grade_bands,
  'grade_label' | 'grade_point' | 'is_pass' | 'min_percentage'
>;

/**
 * Single source of truth for "percentage -> grade" — previously
 * reimplemented 3 times as hardcoded arrays (class-mentors.service.ts,
 * subject-records.service.ts, hod-my-class.service.ts), each with its own
 * copy of the grading scale that had already drifted 1 point off the real
 * `grade_bands` table (see docs/gpa_implementation_plan.md B.3). This reads
 * whatever the DB actually has instead.
 *
 * `bands` must be pre-sorted by `display_order` ascending (fetch via
 * `prisma.grade_bands.findMany({ orderBy: { display_order: 'asc' } })`) —
 * the first band whose `min_percentage` the score qualifies for is the
 * match, same rule the SQL-side `ORDER BY min_percentage DESC LIMIT 1`
 * lookup used elsewhere in the codebase applies.
 */
export function gradeForPercentage(
  percentage: number,
  bands: GradeBandRow[],
): GradeLookupResult {
  for (const b of bands) {
    if (percentage >= Number(b.min_percentage)) {
      return {
        label: b.grade_label,
        point: b.grade_point === null ? null : Number(b.grade_point),
        isPass: b.is_pass,
      };
    }
  }
  const last = bands[bands.length - 1];
  return {
    label: last?.grade_label ?? 'RA',
    point: last?.grade_point != null ? Number(last.grade_point) : null,
    isPass: last?.is_pass ?? false,
  };
}
