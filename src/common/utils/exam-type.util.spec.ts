import { isEndSemesterExam } from './exam-type.util';

describe('isEndSemesterExam', () => {
  it('is false for an internal exam type', () => {
    expect(isEndSemesterExam({ category: 'internal' as any })).toBe(false);
  });

  it('is true for an external exam type', () => {
    expect(isEndSemesterExam({ category: 'external' as any })).toBe(true);
  });
});
