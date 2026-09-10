-- Report page's "Saved reports" grid + "+ Add report" — a lightweight,
-- user-created report log (name/period/note/status). Not in schema.prisma
-- by design — accessed only via $queryRaw/$executeRaw.
--
-- The design's "Media scorecard" (prev-year/target columns), "Requests by
-- department", and "Turnaround time" panels are all hardcoded fake numbers
-- in the source JS with zero real backing anywhere in the schema —
-- deliberately not rebuilt here. This table only covers the one genuinely
-- real piece: naming and describing a report someone intends to compile,
-- not fabricating the report's contents.

CREATE TABLE IF NOT EXISTS media_reports (
  id SERIAL PRIMARY KEY,
  name VARCHAR(200) NOT NULL,
  period VARCHAR(100) NOT NULL,
  note TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'draft', -- draft | final
  created_by_user_id INT NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
