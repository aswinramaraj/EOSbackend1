import { gradeFor } from './marks-roster.service';

const LIVE_BANDS = [
  {
    id: 1,
    grade_label: 'O',
    grade_point: 10,
    is_pass: true,
    display_order: 1,
    min_percentage: 90,
  },
  {
    id: 2,
    grade_label: 'A+',
    grade_point: 9,
    is_pass: true,
    display_order: 2,
    min_percentage: 80,
  },
  {
    id: 3,
    grade_label: 'A',
    grade_point: 8,
    is_pass: true,
    display_order: 3,
    min_percentage: 70,
  },
  {
    id: 4,
    grade_label: 'B+',
    grade_point: 7,
    is_pass: true,
    display_order: 4,
    min_percentage: 60,
  },
  {
    id: 5,
    grade_label: 'B',
    grade_point: 6,
    is_pass: true,
    display_order: 5,
    min_percentage: 50,
  },
  {
    id: 6,
    grade_label: 'RA',
    grade_point: 0,
    is_pass: false,
    display_order: 6,
    min_percentage: 0,
  },
] as any;

describe('marks-roster gradeFor', () => {
  it('returns null for a null total (not yet gradeable)', () => {
    expect(gradeFor(null, LIVE_BANDS)).toBeNull();
  });

  it('grades a boundary score of exactly 90 as O, not A+ — the stale 91-threshold bug this fixes', () => {
    expect(gradeFor(90, LIVE_BANDS)).toBe('O');
  });

  it('grades a boundary score of exactly 80 as A+, not A', () => {
    expect(gradeFor(80, LIVE_BANDS)).toBe('A+');
  });

  it('grades below 50 as RA (matching the rest of the app), not the old literal "U"', () => {
    expect(gradeFor(45, LIVE_BANDS)).toBe('RA');
  });

  it('reads whatever bands are passed in, not a hardcoded scale', () => {
    const customBands = [
      {
        id: 1,
        grade_label: 'PASS',
        grade_point: 1,
        is_pass: true,
        display_order: 1,
        min_percentage: 35,
      },
      {
        id: 2,
        grade_label: 'FAIL',
        grade_point: 0,
        is_pass: false,
        display_order: 2,
        min_percentage: 0,
      },
    ] as any;
    expect(gradeFor(40, customBands)).toBe('PASS');
    expect(gradeFor(30, customBands)).toBe('FAIL');
  });
});
