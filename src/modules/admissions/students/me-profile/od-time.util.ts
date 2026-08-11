/**
 * Shared by MeOdTeamsService (writes from_time/to_time), MeOdRequestsService,
 * and MeOdRequestsListService (both read them back) - a fixed-epoch-date
 * Date object is how Prisma represents a `@db.Timetz` column with no
 * associated calendar date; only the time-of-day portion is ever persisted
 * or read. Same convention as ExamTimetableService's own private
 * toTimeDate() for start_time/end_time, just shared here since three
 * services need it instead of one.
 */
export function toTimeDate(time: string): Date {
  const normalized = time.length === 5 ? `${time}:00` : time;
  return new Date(`1970-01-01T${normalized}.000Z`);
}

/**
 * HH:mm for the API response - friendlier for a client than echoing the
 * full fixed-epoch-date ISO timestamp Prisma reads the column back as.
 */
export function formatTime(time: Date | null): string | null {
  return time ? time.toISOString().slice(11, 16) : null;
}
