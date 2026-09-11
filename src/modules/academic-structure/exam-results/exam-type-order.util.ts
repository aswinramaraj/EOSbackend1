// Faculty/HoD Examination & Results filter's fixed dropdown order — CIA1,
// CIA2, CIA3, Quiz, then the final University End Semester Exam. Shared by
// AdvisorExaminationsService and HodExaminationsService's own getFilters()
// (each builds its own exam_types list independently, but both need the
// same order) so the two pages can never drift apart. Any exam_type name
// not in this list sorts after these, alphabetically — so a newly-added
// exam type never silently vanishes from the dropdown, just falls to the end.
const EXAM_TYPE_ORDER = [
  'CIA1',
  'CIA2',
  'CIA3',
  'Quiz',
  'University End Semester Exam',
];

export function sortExamTypesForFilter<T extends { name: string }>(
  examTypes: T[],
): T[] {
  return [...examTypes].sort((a, b) => {
    const ai = EXAM_TYPE_ORDER.indexOf(a.name);
    const bi = EXAM_TYPE_ORDER.indexOf(b.name);
    if (ai !== -1 && bi !== -1) return ai - bi;
    if (ai !== -1) return -1;
    if (bi !== -1) return 1;
    return a.name.localeCompare(b.name);
  });
}
