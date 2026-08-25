-- ============================================================================
--  Placement: interview scheduling
-- ============================================================================
--  The Interviews page loads today but cannot schedule anything: the backend
--  answers POST /interviews with
--
--      503  "Interview scheduling isn't enabled yet — ask an admin to run
--            query.md #15."
--
--  because `placement_interviews` does not exist. Nothing interview-shaped is
--  in the schema at all — `student_drive_applications.status` /
--  `last_cleared_round` track a student's overall progress through a drive,
--  not individual scheduled sessions with a panel and a slot.
--
--  This is the table the code already expects, taken from query.md section 3.
--  Every column below is read or written by
--  src/modules/placement/interviews/interviews.service.ts, so no code changes
--  are needed once it exists — the 503 simply stops happening.
--
--  A result is deliberately NOT duplicated here: recording one writes through
--  to student_drive_applications, which stays the single source of truth for
--  how far a student got. This table only owns the scheduled session itself.
--
--  Verified against the live database before writing: placement_drives (35
--  rows), students and users all exist, so every foreign key below resolves.
--
--  Safe to re-run.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS placement_interviews (
  id                 SERIAL PRIMARY KEY,
  student_id         INTEGER      NOT NULL REFERENCES students(id),
  drive_id           INTEGER      NOT NULL REFERENCES placement_drives(id),

  -- A real date column, not part of the free-text slot label, so the
  -- "scheduled today" and "upcoming" tiles are computed exactly rather than
  -- by string-matching the slot text.
  interview_date     DATE         NOT NULL,

  round_label        VARCHAR(100) NOT NULL,
  slot_label         VARCHAR(100) NOT NULL,
  panel_member       VARCHAR(150) NOT NULL,

  status             VARCHAR(20)  NOT NULL DEFAULT 'scheduled',
  panel_feedback     VARCHAR(500),

  created_by_user_id INTEGER      REFERENCES users(id),
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ  NOT NULL DEFAULT now()
);

COMMENT ON TABLE placement_interviews IS
  'One scheduled interview session: a student, a drive, a round, a slot and a panel member. The outcome is written through to student_drive_applications rather than stored twice.';

-- The service filters by student and by drive; both are indexed.
CREATE INDEX IF NOT EXISTS idx_placement_interviews_student
  ON placement_interviews(student_id);
CREATE INDEX IF NOT EXISTS idx_placement_interviews_drive
  ON placement_interviews(drive_id);

-- The Interviews page's headline tiles ("scheduled today", "upcoming") filter
-- on date and status together.
CREATE INDEX IF NOT EXISTS idx_placement_interviews_date_status
  ON placement_interviews(interview_date, status);

COMMIT;

-- ── verification (run separately) ───────────────────────────────────────────
-- SELECT count(*) AS interviews FROM placement_interviews;
-- Then schedule one from the Interviews page: the 503 should be gone.
