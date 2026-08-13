/**
 * Server-side mirror of the frontend's grading table
 * (EOS-web-frontend/src/lib/config.ts GRADE_SCALE/computeGpa) — Anna
 * University's standard UG grading convention. There is no grade/GPA table
 * or column anywhere in this schema (exam_marks only stores raw scores),
 * and the one candidate table for a pass/fail rule — exam_pass_rules_settings
 * — is populated with defaults but read by no code anywhere in this
 * repository, so there is no existing precedent for how it's meant to
 * combine with per-exam marks. Kept identical to the frontend's scale so a
 * department-wide average here means the same thing as what a student sees
 * of their own CGPA.
 */
export const GRADE_SCALE: { min: number; grade: string; point: number }[] = [
  { min: 91, grade: 'O', point: 10 },
  { min: 81, grade: 'A+', point: 9 },
  { min: 71, grade: 'A', point: 8 },
  { min: 61, grade: 'B+', point: 7 },
  { min: 50, grade: 'B', point: 6 },
  { min: 0, grade: 'RA', point: 0 },
];

export function percentageToGrade(percentage: number): {
  grade: string;
  point: number;
} {
  const tier =
    GRADE_SCALE.find((t) => percentage >= t.min) ??
    GRADE_SCALE[GRADE_SCALE.length - 1];
  return { grade: tier.grade, point: tier.point };
}

export function isPassingPercentage(percentage: number): boolean {
  return percentageToGrade(percentage).grade !== 'RA';
}

/** Credit-weighted GPA over subjects with a known credit value; subjects missing credits are excluded. */
export function computeGpa(
  subjects: { percentage: number; credits: number | null | undefined }[],
): number | null {
  const weighted = subjects.filter((s) => s.credits != null && s.credits > 0);
  if (weighted.length === 0) return null;
  const totalCredits = weighted.reduce(
    (sum, s) => sum + (s.credits as number),
    0,
  );
  const totalPoints = weighted.reduce(
    (sum, s) =>
      sum + percentageToGrade(s.percentage).point * (s.credits as number),
    0,
  );
  return Math.round((totalPoints / totalCredits) * 100) / 100;
}
