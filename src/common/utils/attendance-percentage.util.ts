/**
 * Which attendance_status_enum values count as "attended" for percentage
 * purposes. `on_duty` is an official absence (the student was on
 * college-approved duty elsewhere, e.g. a sports meet or symposium), not a
 * personal one — it must count the same as `present`, exactly matching
 * AttendanceEligibilityService (the service that actually gates real exam
 * eligibility, and the only attendance-percentage call site in this
 * codebase that already had this right).
 *
 * Every other percentage calculation in this codebase reimplemented
 * present/absent/on_duty independently and got it wrong the same way
 * (counting on_duty toward the denominator but not the numerator) — found
 * across 9 separate call sites in one pass. Use this instead of a new
 * ad-hoc `status === 'present'` check, so on_duty is never miscounted
 * again. The raw-SQL call sites can't call this directly; they use the
 * equivalent `status != 'absent'` filter and should reference this file in
 * their own comment.
 */
export function isAttendedStatus(status: string): boolean {
  return status !== 'absent';
}

/** Percentage of `records` that count as attended (present + on_duty), rounded to 2 decimal places. Returns 0 for an empty list rather than NaN. */
export function calculateAttendancePercentage(
  records: { status: string }[],
): number {
  if (records.length === 0) return 0;
  const attended = records.filter((r) => isAttendedStatus(r.status)).length;
  return Math.round((attended / records.length) * 100 * 100) / 100;
}
