-- ============================================================================
--  Night roll call: draft -> publish
-- ============================================================================
--  The warden marks residents through the evening and then publishes the
--  night's sheet. Until now every mark was final the instant it was saved, so
--  there was no working state to correct before submitting.
--
--  This deliberately mirrors the convention faculty class attendance already
--  uses in this same database:
--
--      attendance_records.is_published  boolean NOT NULL DEFAULT true
--      attendance_records.published_at  timestamp
--
--  so hostel roll call behaves the same way as class attendance rather than
--  inventing a second pattern for the same idea. `status` is untouched and
--  keeps its existing CHECK ('present','absent') -- a draft is not a third
--  status, it is an unpublished one.
--
--  DEFAULT true is intentional and matches attendance_records: rows written
--  before this change were final the moment they were saved, so they read back
--  as published without needing a backfill, and any writer that does not know
--  about drafts still produces published rows. The warden's own marking path
--  writes false explicitly.
--
--  No Prisma model edit is required -- this table is only ever accessed
--  through raw SQL.
--
--  Safe to re-run.
-- ============================================================================

BEGIN;

ALTER TABLE hostel_night_attendance
  ADD COLUMN IF NOT EXISTS is_published boolean NOT NULL DEFAULT true;

ALTER TABLE hostel_night_attendance
  ADD COLUMN IF NOT EXISTS published_at timestamptz NULL;

COMMENT ON COLUMN hostel_night_attendance.is_published IS
  'False while the night''s roll call is still a draft visible only to the warden taking it. Mirrors attendance_records.is_published.';
COMMENT ON COLUMN hostel_night_attendance.published_at IS
  'When the night''s roll call was published. NULL for draft rows.';

-- Rows that already existed were final when saved, so they are stamped as
-- published at the time they were marked rather than left looking unpublished.
UPDATE hostel_night_attendance
SET published_at = marked_at
WHERE is_published = true
  AND published_at IS NULL;

-- Both the publish step and the "is tonight still open?" check look for the
-- unpublished rows of a single date, so index exactly that.
CREATE INDEX IF NOT EXISTS idx_hostel_night_attendance_unpublished
  ON hostel_night_attendance (attendance_date)
  WHERE is_published = false;

COMMIT;

-- ── verification (run separately; expects drafts = 0 immediately after) ─────
-- SELECT count(*) FILTER (WHERE is_published = false) AS drafts,
--        count(*) FILTER (WHERE is_published = true)  AS published,
--        count(*) FILTER (WHERE is_published = true AND published_at IS NULL) AS unstamped
-- FROM hostel_night_attendance;
