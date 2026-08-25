-- ============================================================================
--  HDC: student-level lists behind an application window and a test
-- ============================================================================
--  Today both of these are stored only as integer counters:
--
--    higher_education_application_windows.applicants_count
--    higher_education_test_register.enrolled_count / .cleared_count
--
--  A counter cannot answer "which students?", so there is no way to open an
--  application and add a student to it, which is what is being asked for:
--
--    * open an application window -> add students -> mark Applied / Selected
--    * open a test               -> add students -> Enrolled / Attempted / Cleared
--
--  These two tables add exactly that, and nothing else. They are additive:
--  no existing column, constraint or row is altered, so every screen that
--  reads the counters today keeps working unchanged.
--
--  DELIBERATELY NO COUNTER TRIGGERS
--  --------------------------------
--  It is tempting to keep applicants_count / enrolled_count / cleared_count in
--  sync from these rows automatically. That would be wrong here: the existing
--  counters already hold real figures (GRE 12/8, IELTS 18/15, ...) while the
--  new tables start empty, so any recompute-on-write trigger would reset those
--  numbers to zero the first time a student was added. The counters are left
--  alone as the historical summary; the API reports the real per-student
--  figures from these tables alongside them, and the two can be reconciled
--  deliberately later rather than silently.
--
--  Safe to re-run.
-- ============================================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
--  1. Students attached to an application window  (Applied / Selected)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS higher_education_application_students (
  id                 serial       PRIMARY KEY,

  -- Removing the window removes its student list with it; the list has no
  -- meaning on its own.
  window_id          integer      NOT NULL
                                  REFERENCES higher_education_application_windows(id)
                                  ON DELETE CASCADE,

  -- Student rows are never orphaned either. Name, roll number, register
  -- number and department all come from `students` (and its class ->
  -- department chain) rather than being copied here, so they cannot drift out
  -- of step with the admission record.
  student_id         integer      NOT NULL
                                  REFERENCES students(id)
                                  ON DELETE CASCADE,

  status             varchar(20)  NOT NULL DEFAULT 'applied',
  applied_on         date         NULL,
  decided_on         date         NULL,
  remarks            text         NULL,
  created_at         timestamptz  NOT NULL DEFAULT now(),
  created_by_user_id integer      NULL REFERENCES users(id),

  -- A student appears once per window.
  CONSTRAINT higher_education_application_students_window_student_key
    UNIQUE (window_id, student_id),

  -- Spelled out rather than an enum: this mirrors how the other higher_education
  -- tables already store their status columns (plain varchar + CHECK).
  CONSTRAINT higher_education_application_students_status_check
    CHECK (status IN ('applied', 'selected', 'rejected', 'withdrawn'))
);

COMMENT ON TABLE higher_education_application_students IS
  'Which students are on a given higher-education application window, and whether they were applied or selected. The window''s applicants_count remains the historical summary.';

CREATE INDEX IF NOT EXISTS idx_he_application_students_window
  ON higher_education_application_students (window_id, status);

CREATE INDEX IF NOT EXISTS idx_he_application_students_student
  ON higher_education_application_students (student_id);

-- ─────────────────────────────────────────────────────────────────────────────
--  2. Students attached to a test  (Enrolled / Attempted / Cleared)
-- ─────────────────────────────────────────────────────────────────────────────
--  higher_education_test_register is keyed by test_name (varchar(50)), not by a
--  surrogate id, so the child references that column directly. ON UPDATE
--  CASCADE means renaming a test carries its student list along instead of
--  breaking the link.
--
--  The three stages are stored as dates, not as one status value: a student can
--  be enrolled without having sat the test, and can sit it without clearing it,
--  and the dates record when each of those actually happened. "Enrolled",
--  "Attempted" and "Cleared" are then derived — attempted_on IS NOT NULL, and
--  so on — which also keeps a cleared student correctly counted as attempted.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS higher_education_test_students (
  id                 serial       PRIMARY KEY,

  test_name          varchar(50)  NOT NULL
                                  REFERENCES higher_education_test_register(test_name)
                                  ON UPDATE CASCADE ON DELETE CASCADE,

  student_id         integer      NOT NULL
                                  REFERENCES students(id)
                                  ON DELETE CASCADE,

  enrolled_on        date         NULL,
  attempted_on       date         NULL,
  cleared_on         date         NULL,

  -- Free text on purpose: these tests are scored on entirely different scales
  -- (IELTS 0-9 in half bands, GRE 260-340, TOEFL 0-120).
  score              varchar(50)  NULL,
  remarks            text         NULL,
  created_at         timestamptz  NOT NULL DEFAULT now(),
  created_by_user_id integer      NULL REFERENCES users(id),

  CONSTRAINT higher_education_test_students_test_student_key
    UNIQUE (test_name, student_id),

  -- A result cannot precede the sitting, and a sitting cannot precede
  -- enrolment. Catches a mistyped date at entry instead of leaving an
  -- impossible record to be discovered in a report later.
  CONSTRAINT higher_education_test_students_stage_order_check
    CHECK (
      (attempted_on IS NULL OR enrolled_on IS NULL OR attempted_on >= enrolled_on)
      AND (cleared_on IS NULL OR attempted_on IS NULL OR cleared_on >= attempted_on)
    ),

  -- Clearing a test you never sat is not a state that should be recordable.
  CONSTRAINT higher_education_test_students_cleared_requires_attempt_check
    CHECK (cleared_on IS NULL OR attempted_on IS NOT NULL)
);

COMMENT ON TABLE higher_education_test_students IS
  'Which students are registered for each higher-education entrance test, and how far they got. Enrolled/Attempted/Cleared are derived from the three date columns.';

CREATE INDEX IF NOT EXISTS idx_he_test_students_test
  ON higher_education_test_students (test_name);

CREATE INDEX IF NOT EXISTS idx_he_test_students_student
  ON higher_education_test_students (student_id);

-- Partial indexes for the two figures the readiness view reports most.
CREATE INDEX IF NOT EXISTS idx_he_test_students_attempted
  ON higher_education_test_students (test_name)
  WHERE attempted_on IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_he_test_students_cleared
  ON higher_education_test_students (test_name)
  WHERE cleared_on IS NOT NULL;

COMMIT;

-- ── verification (run separately) ───────────────────────────────────────────
-- SELECT w.id, w.university, w.intake,
--        w.applicants_count                                        AS legacy_count,
--        count(s.*)                                                AS students_listed,
--        count(*) FILTER (WHERE s.status = 'selected')             AS selected
-- FROM higher_education_application_windows w
-- LEFT JOIN higher_education_application_students s ON s.window_id = w.id
-- GROUP BY w.id, w.university, w.intake, w.applicants_count
-- ORDER BY w.id;
--
-- SELECT r.test_name,
--        r.enrolled_count                                          AS legacy_enrolled,
--        r.cleared_count                                           AS legacy_cleared,
--        count(t.*)                                                AS students_listed,
--        count(*) FILTER (WHERE t.attempted_on IS NOT NULL)         AS attempted,
--        count(*) FILTER (WHERE t.cleared_on   IS NOT NULL)         AS cleared
-- FROM higher_education_test_register r
-- LEFT JOIN higher_education_test_students t ON t.test_name = r.test_name
-- GROUP BY r.test_name, r.enrolled_count, r.cleared_count
-- ORDER BY r.test_name;
