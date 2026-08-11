/**
 * Shared by MeOdRequestsService (GET /me/od-requests/:id) and
 * MeOdRequestsListService (GET /me/od-requests) so the two never drift on
 * this precedence rule.
 *
 * Precedence: mentor gate first — a mentor rejection is terminal on its own
 * (fixed: an earlier version of this function treated "mentor rejected"
 * the same as "mentor still pending", both falling through to
 * 'pending_mentor' - which was unreachable while nothing could actually set
 * mentor_approval_status to 'rejected', but became a live bug the moment a
 * faculty mentor-approve endpoint existed to do exactly that). Once the
 * mentor has approved: any-rejected short-circuits to rejected regardless
 * of other departments' approved/pending state, then any-pending, then
 * all-approved. See the original single-request service's doc comment for
 * why this ordering (not "any pending before any rejected") was chosen — it
 * matches the spec author's own explicit "Future Improvements"
 * recommendation, not incidental wording order.
 */
export function computeOverallStatus(
  mentorStatus: string,
  approvalStatuses: string[],
): string {
  if (mentorStatus === 'rejected') {
    return 'rejected';
  }
  if (mentorStatus !== 'approved') {
    return 'pending_mentor';
  }
  if (approvalStatuses.some((s) => s === 'rejected')) {
    return 'rejected';
  }
  if (approvalStatuses.some((s) => s === 'pending')) {
    return 'pending_hod';
  }
  return 'approved';
}
