-- Phase 3: Timetable versioning
-- Correction: exam_timetable has 1068 real rows, NOT test data — this is
-- now an in-place ALTER migration that backfills those rows into the new
-- versioned structure, instead of the drop+recreate I wrote before.
-- Run this whole file against the DB, then tell me when it's done.

BEGIN;

-- Elective support: two electives can share an exam session (students split
-- across whichever they picked), but a core paper still conflicts with
-- anything else for the same class. Mark the relevant class_subjects rows
-- as elective yourself afterward (no CRUD API exists for class_subjects —
-- it's seeded/managed directly), e.g.:
--   UPDATE class_subjects SET is_elective = true WHERE class_id = ... AND subject_id IN (...);
ALTER TABLE class_subjects ADD COLUMN is_elective BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE exam_subject_mapping ADD COLUMN is_elective BOOLEAN NOT NULL DEFAULT false;

-- New enums
CREATE TYPE exam_session_enum AS ENUM ('FN', 'AN');
CREATE TYPE timetable_version_status_enum AS ENUM ('draft', 'ready_to_publish', 'published', 'superseded', 'withdrawn');

-- New parent table: one row per draft/published version of an exam's timetable
CREATE TABLE exam_timetable_versions (
  id                    SERIAL PRIMARY KEY,
  exam_id               INTEGER NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  department_id         INTEGER REFERENCES departments(id),
  version_number        INTEGER NOT NULL,
  status                timetable_version_status_enum NOT NULL DEFAULT 'draft',
  signature             VARCHAR(64),
  created_by_user_id    INTEGER REFERENCES users(id),
  created_at            TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  published_by_user_id  INTEGER REFERENCES users(id),
  published_at          TIMESTAMPTZ(6),
  withdrawn_at          TIMESTAMPTZ(6),
  UNIQUE (exam_id, department_id, version_number)
);

-- Backfill: one v1 version per exam that already has exam_timetable rows,
-- department_id left NULL (old rows had no department scoping at all).
-- Marked 'published' if any of that exam's old rows were is_published,
-- else 'draft' — this is the best available proxy from the old per-row flag.
INSERT INTO exam_timetable_versions (exam_id, department_id, version_number, status)
SELECT
  esm.exam_id,
  NULL,
  1,
  CASE WHEN bool_or(et.is_published) THEN 'published'::timetable_version_status_enum
       ELSE 'draft'::timetable_version_status_enum END
FROM exam_timetable et
JOIN exam_subject_mapping esm ON esm.id = et.exam_subject_mapping_id
GROUP BY esm.exam_id;

-- Add the new columns to the existing table, nullable for now so the
-- backfill below can populate them before we lock them down NOT NULL.
ALTER TABLE exam_timetable ADD COLUMN version_id INTEGER;
ALTER TABLE exam_timetable ADD COLUMN session exam_session_enum;
ALTER TABLE exam_timetable ADD COLUMN venue_id INTEGER;

-- Backfill version_id from the v1 version just created for each row's exam.
UPDATE exam_timetable et
SET version_id = etv.id
FROM exam_subject_mapping esm
JOIN exam_timetable_versions etv ON etv.exam_id = esm.exam_id AND etv.version_number = 1
WHERE esm.id = et.exam_subject_mapping_id;

-- Backfill session from start_time (before noon -> FN, else AN) — the old
-- schema had no session column at all, this is the closest real signal.
UPDATE exam_timetable
SET session = CASE WHEN start_time < '12:00:00' THEN 'FN'::exam_session_enum ELSE 'AN'::exam_session_enum END;

-- Now that every row has both, lock them down.
ALTER TABLE exam_timetable ALTER COLUMN version_id SET NOT NULL;
ALTER TABLE exam_timetable ALTER COLUMN session SET NOT NULL;

-- Drop the old "one row per mapping, ever" constraint and the flag it replaces.
ALTER TABLE exam_timetable DROP CONSTRAINT exam_timetable_exam_subject_mapping_id_key;
ALTER TABLE exam_timetable DROP COLUMN is_published;

-- Wire up the new relations and the version-scoped uniqueness.
ALTER TABLE exam_timetable ADD CONSTRAINT exam_timetable_version_id_fkey
  FOREIGN KEY (version_id) REFERENCES exam_timetable_versions(id) ON DELETE CASCADE;
ALTER TABLE exam_timetable ADD CONSTRAINT exam_timetable_venue_id_fkey
  FOREIGN KEY (venue_id) REFERENCES venues(id);
ALTER TABLE exam_timetable ADD CONSTRAINT exam_timetable_version_id_exam_subject_mapping_id_key
  UNIQUE (version_id, exam_subject_mapping_id);

COMMIT;
