import {
  gradeForPercentage,
  type GradeLookupResult,
} from './grade-lookup.util';
import type { grade_bands } from 'generated/prisma/client';

type GradeBandRow = Pick<
  grade_bands,
  'grade_label' | 'grade_point' | 'is_pass' | 'min_percentage'
>;

export interface SubjectResult {
  credits: number;
  percentage: number;
}

export interface SemesterAggregate {
  totalCredits: number;
  /** Exact, unrounded sum of credit×gradePoint — see docs/gpa_implementation_plan.md K: only the final SGPA/CGPA is rounded, never an intermediate. */
  totalWeightedPoints: number;
  sgpa: number | null;
}

export interface CumulativeAggregate {
  cumulativeCredits: number;
  cumulativeWeightedPoints: number;
  cgpa: number | null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * SGPA = Σ(Credit × GradePoint) / Σ(Credits), one semester — matches
 * docs/gpa.md's formula and worked example exactly. A subject with
 * zero/negative credits, or whose grade has no resolvable grade point
 * (grade_bands.grade_point is null), is excluded from both the numerator
 * and denominator rather than coerced to 0 — genuinely unknown stays
 * unknown, never fabricated.
 */
export function computeSemesterAggregate(
  subjects: SubjectResult[],
  bands: GradeBandRow[],
): SemesterAggregate {
  let totalCredits = 0;
  let totalWeightedPoints = 0;

  for (const s of subjects) {
    if (s.credits <= 0) continue;
    const grade: GradeLookupResult = gradeForPercentage(s.percentage, bands);
    if (grade.point === null) continue;
    totalWeightedPoints += grade.point * s.credits;
    totalCredits += s.credits;
  }

  return {
    totalCredits,
    totalWeightedPoints,
    sgpa: totalCredits > 0 ? round2(totalWeightedPoints / totalCredits) : null,
  };
}

/**
 * CGPA = Σ(Credit × GradePoint) / Σ(Credits), across every semester —
 * accumulated from each semester's exact (unrounded) totals, never by
 * multiplying an already-rounded SGPA back out. That's what makes this
 * agree with the true subject-level formula even when a semester's SGPA
 * was itself rounded for display (see docs/gpa_implementation_plan.md E —
 * this is the fix for B.2 row 7's "plain average of rounded SGPAs" bug).
 */
export function computeCumulativeAggregate(
  priorCumulativeCredits: number,
  priorCumulativeWeightedPoints: number,
  semester: SemesterAggregate,
): CumulativeAggregate {
  const cumulativeCredits = priorCumulativeCredits + semester.totalCredits;
  const cumulativeWeightedPoints =
    priorCumulativeWeightedPoints + semester.totalWeightedPoints;

  return {
    cumulativeCredits,
    cumulativeWeightedPoints,
    cgpa:
      cumulativeCredits > 0
        ? round2(cumulativeWeightedPoints / cumulativeCredits)
        : null,
  };
}
