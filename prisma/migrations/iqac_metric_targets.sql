-- IQAC "Target" / "Attainment" cards on every Academic Quality metric page
-- (Attendance, Results, Grade distribution, and eventually Course/Program
-- attainment) currently show "—" because no real "approved by the IQAC for
-- this AY" figure exists anywhere in the schema. Grepped the whole schema
-- for anything target/goal-shaped tied to a metric+year — nothing exists.
-- This one small table covers all of them: one row per metric per academic
-- year. I have not run this and will not run it myself, per the standing
-- rule. Run it yourself, then `npx prisma db pull` + `npx prisma generate`
-- same as every prior migration this session.

CREATE TABLE iqac_metric_targets (
  id SERIAL PRIMARY KEY,
  metric_key VARCHAR(40) NOT NULL, -- 'attendance' | 'results' | 'cgpa' | 'course-attainment' | 'program-attainment' (hyphenated — must match the metric `key` in qualityDomains.ts / SCORECARD_METRICS exactly, not an underscore variant)
  academic_year VARCHAR(20) NOT NULL, -- e.g. '2026-2027'
  target_value NUMERIC(6,2) NOT NULL, -- e.g. 90.00 for attendance/results %, 2.80 for outcomes on the 3-point NBA scale
  set_by_user_id INT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (metric_key, academic_year)
);

-- Example seed rows (edit the values, then run):
-- INSERT INTO iqac_metric_targets (metric_key, academic_year, target_value, set_by_user_id) VALUES
--   ('attendance',          '2026-2027', 90.00, 22),
--   ('results',             '2026-2027', 85.00, 22),
--   ('cgpa',                '2026-2027', 7.50,  22),
--   ('course-attainment',   '2026-2027', 2.80,  22),
--   ('program-attainment',  '2026-2027', 2.80,  22);
