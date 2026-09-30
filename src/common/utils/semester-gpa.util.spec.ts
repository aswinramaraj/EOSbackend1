import {
  computeSemesterAggregate,
  computeCumulativeAggregate,
} from './semester-gpa.util';

// Matches the live grade_bands table (docs/gpa_implementation_plan.md A.3).
const LIVE_BANDS = [
  { grade_label: 'O', grade_point: 10, is_pass: true, min_percentage: 90 },
  { grade_label: 'A+', grade_point: 9, is_pass: true, min_percentage: 80 },
  { grade_label: 'A', grade_point: 8, is_pass: true, min_percentage: 70 },
  { grade_label: 'B+', grade_point: 7, is_pass: true, min_percentage: 60 },
  { grade_label: 'B', grade_point: 6, is_pass: true, min_percentage: 50 },
  { grade_label: 'RA', grade_point: 0, is_pass: false, min_percentage: 0 },
] as any;

describe('computeSemesterAggregate', () => {
  it('reproduces the exact worked example from gpa.md (139/16 = 8.6875 -> 8.69)', () => {
    const subjects = [
      { credits: 4, percentage: 85 }, // A+ (9)
      { credits: 4, percentage: 75 }, // A (8)
      { credits: 3, percentage: 85 }, // A+ (9)
      { credits: 3, percentage: 75 }, // A (8)
      { credits: 2, percentage: 95 }, // O (10)
    ];

    const result = computeSemesterAggregate(subjects, LIVE_BANDS);

    expect(result.totalCredits).toBe(16);
    expect(result.totalWeightedPoints).toBe(139);
    expect(result.sgpa).toBe(8.69);
  });

  it('excludes a zero-credit subject from both numerator and denominator', () => {
    const result = computeSemesterAggregate(
      [
        { credits: 4, percentage: 90 }, // O, 40 points
        { credits: 0, percentage: 95 }, // excluded
      ],
      LIVE_BANDS,
    );
    expect(result.totalCredits).toBe(4);
    expect(result.totalWeightedPoints).toBe(40);
    expect(result.sgpa).toBe(10);
  });

  it('excludes a negative-credit subject the same way (defensive — should not occur given DTO validation)', () => {
    const result = computeSemesterAggregate(
      [{ credits: -2, percentage: 90 }, { credits: 3, percentage: 70 }],
      LIVE_BANDS,
    );
    expect(result.totalCredits).toBe(3);
    expect(result.totalWeightedPoints).toBe(24);
  });

  it('returns a null SGPA (not NaN or 0) for a semester with no gradeable subjects', () => {
    expect(computeSemesterAggregate([], LIVE_BANDS)).toEqual({
      totalCredits: 0,
      totalWeightedPoints: 0,
      sgpa: null,
    });
  });

  it('a failed (RA) subject still counts — lowers the average, is not excluded', () => {
    const result = computeSemesterAggregate(
      [
        { credits: 4, percentage: 90 }, // O, 40
        { credits: 4, percentage: 30 }, // RA, 0
      ],
      LIVE_BANDS,
    );
    expect(result.totalCredits).toBe(8); // both subjects' credits count
    expect(result.totalWeightedPoints).toBe(40);
    expect(result.sgpa).toBe(5); // 40/8, not 40/4
  });

  it('handles the live boundary exactly (90% -> O, 89.99% -> A+)', () => {
    expect(computeSemesterAggregate([{ credits: 1, percentage: 90 }], LIVE_BANDS).totalWeightedPoints).toBe(10);
    expect(computeSemesterAggregate([{ credits: 1, percentage: 89.99 }], LIVE_BANDS).totalWeightedPoints).toBe(9);
  });
});

describe('computeCumulativeAggregate', () => {
  it('reproduces the exact worked example from gpa.md (386/44 = 8.7727 -> 8.77)', () => {
    // Sem 1: SGPA 8.50 over 20 credits -> exact weighted points 170.
    // Sem 2: SGPA 9.00 over 24 credits -> exact weighted points 216.
    const sem2: ReturnType<typeof computeSemesterAggregate> = {
      totalCredits: 24,
      totalWeightedPoints: 216,
      sgpa: 9.0,
    };

    const result = computeCumulativeAggregate(20, 170, sem2);

    expect(result.cumulativeCredits).toBe(44);
    expect(result.cumulativeWeightedPoints).toBe(386);
    expect(result.cgpa).toBe(8.77);
  });

  it('accumulates from exact per-semester totals, not by multiplying an already-rounded SGPA back out (the B.2 row-7 fix)', () => {
    // A semester whose true weighted-points/credits doesn't divide evenly —
    // its SGPA gets rounded for display, but the cumulative math must still
    // use the exact underlying totals, not sgpa * credits.
    const sem: ReturnType<typeof computeSemesterAggregate> = {
      totalCredits: 16,
      totalWeightedPoints: 139, // true value; 139/16 = 8.6875 -> displayed 8.69
      sgpa: 8.69,
    };

    const result = computeCumulativeAggregate(0, 0, sem);

    // If this had instead multiplied the rounded 8.69 * 16 = 139.04, the
    // cumulative totals would already have drifted from the true 139.
    expect(result.cumulativeWeightedPoints).toBe(139);
    expect(result.cgpa).toBe(8.69);
  });

  it('returns a null CGPA for a student with no completed semesters yet', () => {
    const empty: ReturnType<typeof computeSemesterAggregate> = {
      totalCredits: 0,
      totalWeightedPoints: 0,
      sgpa: null,
    };
    expect(computeCumulativeAggregate(0, 0, empty).cgpa).toBeNull();
  });

  it('reflects only completed semesters for a partially-completed record', () => {
    // 3 of 8 semesters done: cumulative is computed only over those 3,
    // never inferring or padding for the other 5.
    const sem3: ReturnType<typeof computeSemesterAggregate> = {
      totalCredits: 18,
      totalWeightedPoints: 144,
      sgpa: 8.0,
    };
    const result = computeCumulativeAggregate(38, 316, sem3); // sem1+sem2 prior totals
    expect(result.cumulativeCredits).toBe(56);
    expect(result.cumulativeWeightedPoints).toBe(460);
    expect(result.cgpa).toBe(8.21);
  });
});
