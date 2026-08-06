-- Phase 8: Grade-scale settings + Results computation
-- Two brand-new standalone tables, zero existing data at risk.

BEGIN;

CREATE TABLE exam_pass_rules_settings (
  id                  SERIAL PRIMARY KEY,
  internal_max_marks  DECIMAL(6, 2) NOT NULL DEFAULT 40,
  external_max_marks  DECIMAL(6, 2) NOT NULL DEFAULT 60,
  pass_mark_total     DECIMAL(6, 2) NOT NULL DEFAULT 50,
  min_external_marks  DECIMAL(6, 2) NOT NULL DEFAULT 24,
  updated_at          TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);

CREATE TABLE grade_bands (
  id             SERIAL PRIMARY KEY,
  grade_label    VARCHAR(10) NOT NULL UNIQUE,
  min_percentage DECIMAL(5, 2) NOT NULL,
  grade_point    DECIMAL(3, 1),
  is_pass        BOOLEAN NOT NULL DEFAULT true,
  display_order  INTEGER NOT NULL
);

-- Seed the default grade scale shown in the mockup.
INSERT INTO grade_bands (grade_label, min_percentage, grade_point, is_pass, display_order) VALUES
  ('O',  91, 10.0, true,  1),
  ('A+', 81, 9.0,  true,  2),
  ('A',  71, 8.0,  true,  3),
  ('B+', 61, 7.0,  true,  4),
  ('B',  50, 6.0,  true,  5),
  ('U',  0,  0.0,  false, 6);

COMMIT;
