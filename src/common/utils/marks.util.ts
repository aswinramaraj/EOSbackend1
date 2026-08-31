/**
 * Marks-obtained/max-marks -> percentage, rounded to 1 decimal place.
 * Single source of truth for the "converted to 100" figure, previously
 * duplicated ad hoc in exam-results-grid.service.ts and
 * subject-records.service.ts.
 */
export function toPercentage(
  obtained: number | null | undefined,
  max: number | null | undefined,
): number | null {
  if (obtained == null || max == null || max <= 0) return null;
  return Math.round((obtained / max) * 1000) / 10;
}
