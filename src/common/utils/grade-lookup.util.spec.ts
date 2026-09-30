import { gradeForPercentage } from './grade-lookup.util';

// Matches the live grade_bands table (see docs/gpa_implementation_plan.md
// A.3) — 6 bands, not the 7-band scale prisma/seed.sql describes.
const LIVE_BANDS = [
  { grade_label: 'O', grade_point: 10 as any, is_pass: true, min_percentage: 90 as any },
  { grade_label: 'A+', grade_point: 9 as any, is_pass: true, min_percentage: 80 as any },
  { grade_label: 'A', grade_point: 8 as any, is_pass: true, min_percentage: 70 as any },
  { grade_label: 'B+', grade_point: 7 as any, is_pass: true, min_percentage: 60 as any },
  { grade_label: 'B', grade_point: 6 as any, is_pass: true, min_percentage: 50 as any },
  { grade_label: 'RA', grade_point: 0 as any, is_pass: false, min_percentage: 0 as any },
];

describe('gradeForPercentage', () => {
  it('picks the highest-qualifying band, not the first numerically-close one', () => {
    expect(gradeForPercentage(95, LIVE_BANDS)).toEqual({ label: 'O', point: 10, isPass: true });
    expect(gradeForPercentage(90, LIVE_BANDS)).toEqual({ label: 'O', point: 10, isPass: true });
  });

  it('handles every live boundary exactly (the off-by-one this replaces a hardcoded 91/81/71/61 scale for)', () => {
    expect(gradeForPercentage(89.99, LIVE_BANDS).label).toBe('A+');
    expect(gradeForPercentage(80, LIVE_BANDS).label).toBe('A+');
    expect(gradeForPercentage(70, LIVE_BANDS).label).toBe('A');
    expect(gradeForPercentage(60, LIVE_BANDS).label).toBe('B+');
    expect(gradeForPercentage(50, LIVE_BANDS)).toEqual({ label: 'B', point: 6, isPass: true });
    expect(gradeForPercentage(49.99, LIVE_BANDS)).toEqual({ label: 'RA', point: 0, isPass: false });
  });

  it('falls back to the last (lowest) band for a percentage below every band', () => {
    expect(gradeForPercentage(-5, LIVE_BANDS)).toEqual({ label: 'RA', point: 0, isPass: false });
  });

  it('returns a null point when a band has no grade_point set, rather than coercing to 0', () => {
    const bandsWithNullPoint = [
      { grade_label: 'X', grade_point: null, is_pass: true, min_percentage: 0 as any },
    ];
    expect(gradeForPercentage(50, bandsWithNullPoint as any)).toEqual({
      label: 'X',
      point: null,
      isPass: true,
    });
  });

  it('returns a safe default when given an empty band list', () => {
    expect(gradeForPercentage(75, [])).toEqual({ label: 'RA', point: null, isPass: false });
  });
});
