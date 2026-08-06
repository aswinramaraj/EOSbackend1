-- Phase 5: Invigilation roles + allocation batches
-- 36 existing invigilation_duties rows, all with shift = 'FN' — trivial
-- backfill into the new session enum column, no data at risk.

BEGIN;

CREATE TYPE invigilation_role_enum AS ENUM ('chief', 'relief');
CREATE TYPE invigilation_allocation_status_enum AS ENUM ('draft', 'submitted', 'published');

CREATE TABLE invigilation_allocation_batches (
  id                    SERIAL PRIMARY KEY,
  exam_id               INTEGER NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  exam_date             DATE NOT NULL,
  session               exam_session_enum NOT NULL,
  status                invigilation_allocation_status_enum NOT NULL DEFAULT 'draft',
  created_by_user_id    INTEGER REFERENCES users(id),
  created_at            TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  published_by_user_id  INTEGER REFERENCES users(id),
  published_at          TIMESTAMPTZ(6),
  UNIQUE (exam_id, exam_date, session)
);

ALTER TABLE invigilation_duties ADD COLUMN session exam_session_enum;
UPDATE invigilation_duties SET session = shift::exam_session_enum;
ALTER TABLE invigilation_duties ALTER COLUMN session SET NOT NULL;
ALTER TABLE invigilation_duties DROP COLUMN shift;

ALTER TABLE invigilation_duties ADD COLUMN role invigilation_role_enum NOT NULL DEFAULT 'relief';
ALTER TABLE invigilation_duties ADD COLUMN allocation_batch_id INTEGER REFERENCES invigilation_allocation_batches(id);

COMMIT;
