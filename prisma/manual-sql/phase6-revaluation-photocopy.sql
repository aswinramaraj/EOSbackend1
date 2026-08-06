-- Phase 6: Revaluation window + photocopy requests
-- 50 existing revaluation_requests rows — every new column is
-- nullable/defaulted, purely additive, no data at risk.

BEGIN;

ALTER TYPE revaluation_status_enum ADD VALUE IF NOT EXISTS 'approved';
ALTER TYPE revaluation_status_enum ADD VALUE IF NOT EXISTS 'rejected';

CREATE TYPE revaluation_application_type_enum AS ENUM ('photocopy_and_reval', 'photocopy_only', 'reval_only');
CREATE TYPE photocopy_status_enum AS ENUM ('requested', 'scanned', 'issued', 'rejected');

ALTER TABLE revaluation_requests ADD COLUMN subject_id INTEGER REFERENCES subjects(id);
ALTER TABLE revaluation_requests ADD COLUMN exam_id INTEGER REFERENCES exams(id);
ALTER TABLE revaluation_requests ADD COLUMN remarks VARCHAR(1000);
ALTER TABLE revaluation_requests ADD COLUMN evaluator_faculty_id INTEGER REFERENCES faculty(id);
ALTER TABLE revaluation_requests ADD COLUMN fee_amount DECIMAL(8, 2);
ALTER TABLE revaluation_requests ADD COLUMN fee_paid BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE revaluation_windows (
  id                       SERIAL PRIMARY KEY,
  exam_id                  INTEGER NOT NULL UNIQUE REFERENCES exams(id) ON DELETE CASCADE,
  application_type         revaluation_application_type_enum NOT NULL DEFAULT 'reval_only',
  is_open                  BOOLEAN NOT NULL DEFAULT false,
  opens_at                 TIMESTAMPTZ(6),
  closes_at                TIMESTAMPTZ(6),
  fee_per_paper            DECIMAL(8, 2) NOT NULL,
  photocopy_fee_per_paper  DECIMAL(8, 2) NOT NULL,
  max_papers_per_student   INTEGER,
  created_by_user_id       INTEGER REFERENCES users(id),
  created_at               TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);

CREATE TABLE photocopy_requests (
  id                    SERIAL PRIMARY KEY,
  student_id            INTEGER NOT NULL REFERENCES students(id),
  exam_marks_id         INTEGER NOT NULL REFERENCES exam_marks(id),
  fee_amount            DECIMAL(8, 2) NOT NULL,
  status                photocopy_status_enum NOT NULL DEFAULT 'requested',
  applied_at            TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  processed_by_user_id  INTEGER REFERENCES users(id),
  processed_at          TIMESTAMPTZ(6),
  UNIQUE (student_id, exam_marks_id)
);

COMMIT;
