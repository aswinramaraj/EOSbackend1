import type { exam_type_category_enum } from 'generated/prisma/enums';

/**
 * Single authoritative "is this a real end-semester exam" check — retires
 * two weaker signals found duplicated elsewhere (matching the exam type's
 * *name* text for "end semester"/"university", and the separate
 * `exam_types.is_university` boolean), in favor of the one signal that was
 * already load-bearing for a real permission gate:
 * `exam-marks.service.ts`'s `assertInternalExam` already refuses to let
 * Faculty touch a non-internal exam based on this exact field. Every
 * SGPA/CGPA calculation should agree with that same rule, not each pick
 * its own independent way to answer the same question (see
 * docs/gpa_implementation_plan.md B.5).
 */
export function isEndSemesterExam(examType: {
  category: exam_type_category_enum;
}): boolean {
  return examType.category !== 'internal';
}
