-- ============================================================================
--  Social posts: multiple photos/videos per post  +  staff attendance guard
-- ============================================================================
--  Section 1 adds announcement_media so a Media Room post can carry several
--  photos and/or videos that the app shows as a swipeable carousel, the way
--  Instagram/LinkedIn do. Until now an announcement had exactly one file
--  (announcements.file_key) with no ordering and no notion of video.
--
--  Deliberately a NEW table rather than routing posts through
--  department_achievements/achievement_media: an announcement carries
--  targeting, scheduling, pin/expiry and comments that an achievement does
--  not, and collapsing the two would lose all of that.
--
--  Section 2 closes a real hole in an EXISTING table (index only, no schema
--  change) -- see its own note.
--
--  Safe to re-run.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Media attached to an announcement
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS announcement_media (
  id               SERIAL      PRIMARY KEY,
  announcement_id  INTEGER     NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,

  -- Reuses the project's existing photo/video vocabulary rather than adding a
  -- second enum with the same two values. (achievement_media_type_enum is
  -- named for where it first appeared; its values are exactly photo | video.)
  media_type       achievement_media_type_enum NOT NULL,

  -- The storage object key, NOT a URL. Public/signed URLs are derived from the
  -- key on every read (see StorageService.getPublicUrl and the comment in
  -- AnnouncementsService.toResponseShape) so a stored URL can never go stale
  -- or expire.
  storage_key      VARCHAR(500) NOT NULL,

  -- Poster frame for a video. Null for photos.
  thumbnail_key    VARCHAR(500),

  -- Intrinsic pixel size, captured at upload. This is what lets the app
  -- reserve the correct aspect ratio BEFORE the image downloads, so the feed
  -- does not jump as each photo loads, and lets a small image be shown at its
  -- true shape instead of being stretched to fill a guessed box.
  width            INTEGER,
  height           INTEGER,

  duration_seconds INTEGER,

  -- Carousel order, 1-based.
  sequence_no      SMALLINT    NOT NULL DEFAULT 1,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT announcement_media_seq_range_check
    CHECK (sequence_no BETWEEN 1 AND 10),

  -- Width and height are only meaningful together.
  CONSTRAINT announcement_media_dims_check
    CHECK ((width IS NULL) = (height IS NULL)),

  CONSTRAINT announcement_media_dims_positive_check
    CHECK (width IS NULL OR (width > 0 AND height > 0)),

  CONSTRAINT announcement_media_duration_check
    CHECK (duration_seconds IS NULL OR duration_seconds > 0),

  -- A video should have a poster frame; a photo must not pretend to.
  CONSTRAINT announcement_media_thumbnail_check
    CHECK (media_type = 'video' OR thumbnail_key IS NULL),

  -- No two items may claim the same slide position.
  CONSTRAINT announcement_media_unique_seq
    UNIQUE (announcement_id, sequence_no)
);

COMMENT ON TABLE announcement_media IS
  'Photos/videos attached to an announcement, shown as an ordered carousel. Ordering is sequence_no (1-based); URLs are derived from storage_key on read, never stored.';
COMMENT ON COLUMN announcement_media.width IS
  'Intrinsic pixel width captured at upload, so the client can reserve the right aspect ratio before the file downloads.';

CREATE INDEX IF NOT EXISTS idx_announcement_media_announcement
  ON announcement_media (announcement_id, sequence_no);

-- ---------------------------------------------------------------------------
-- 2. Non-teaching staff attendance: stop duplicate rows per day
-- ---------------------------------------------------------------------------
--  faculty_daily_attendance already supports non-teaching staff via
--  staff_user_id (nullable, with a users relation) -- no new table is needed
--  for staff attendance, and none is created here.
--
--  But its only uniqueness guard is @@unique([faculty_id, attendance_date]).
--  In Postgres, NULLs are distinct in a unique index, so for a STAFF row
--  (faculty_id NULL) that constraint enforces nothing at all: the same person
--  could be marked twice, or present and absent, on the same date.
--
--  Index only. No column is added or changed, and existing rows are untouched.
--
--  NOTE: if this fails with a duplicate-key error, you already have duplicate
--  staff rows. Find them with the query in section 3 and resolve those first.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS uq_faculty_daily_attendance_staff_date
  ON faculty_daily_attendance (staff_user_id, attendance_date)
  WHERE staff_user_id IS NOT NULL;

COMMIT;


-- ── 3. Only needed if section 2 failed: find the duplicates ─────────────────
-- SELECT staff_user_id, attendance_date, COUNT(*) AS rows
-- FROM faculty_daily_attendance
-- WHERE staff_user_id IS NOT NULL
-- GROUP BY staff_user_id, attendance_date
-- HAVING COUNT(*) > 1
-- ORDER BY rows DESC, attendance_date;


-- ── 4. Verify ───────────────────────────────────────────────────────────────
SELECT 'announcement_media' AS object,
       (SELECT COUNT(*)::int FROM information_schema.tables
         WHERE table_name = 'announcement_media') AS present
UNION ALL
SELECT 'staff attendance unique index',
       (SELECT COUNT(*)::int FROM pg_indexes
         WHERE indexname = 'uq_faculty_daily_attendance_staff_date');
