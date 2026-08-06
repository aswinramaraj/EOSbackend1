-- Phase 4: Seating versioning + patterns
-- Purely additive: new enums, 3 new tables, 2 new nullable/defaulted columns
-- on seating_arrangements. No existing data (18 hall_plans, 2700
-- seating_arrangements rows) is touched or at risk.
-- Run this whole file against the DB, then tell me when it's done.

BEGIN;

CREATE TYPE seating_allocation_mode_enum AS ENUM ('automatic', 'manual');
CREATE TYPE seating_pattern_enum AS ENUM (
  'sequential', 'alternate_seat', 'rowwise_mixed',
  'columnwise_mixed', 'checkerboard', 'snake_order'
);

-- One row per draft/published version of a seating plan for one
-- exam+date+session — mirrors exam_timetable_versions.
CREATE TABLE seating_plan_versions (
  id                    SERIAL PRIMARY KEY,
  exam_id               INTEGER NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  exam_date             DATE NOT NULL,
  session               exam_session_enum NOT NULL,
  version_number        INTEGER NOT NULL,
  status                timetable_version_status_enum NOT NULL DEFAULT 'draft',
  signature             VARCHAR(64),
  created_by_user_id    INTEGER REFERENCES users(id),
  created_at            TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  published_by_user_id  INTEGER REFERENCES users(id),
  published_at          TIMESTAMPTZ(6),
  withdrawn_at          TIMESTAMPTZ(6),
  UNIQUE (exam_id, exam_date, session, version_number)
);

-- One row per venue included in a version. hall_plan_id is filled in only
-- once allocation actually runs (a real hall_plans row is materialized or
-- reused at that point) — draft planning can exist before that.
CREATE TABLE seating_plan_version_venues (
  id               SERIAL PRIMARY KEY,
  version_id       INTEGER NOT NULL REFERENCES seating_plan_versions(id) ON DELETE CASCADE,
  venue_id         INTEGER NOT NULL REFERENCES venues(id),
  hall_plan_id     INTEGER REFERENCES hall_plans(id),
  allocation_mode  seating_allocation_mode_enum NOT NULL DEFAULT 'automatic',
  pattern          seating_pattern_enum,
  UNIQUE (version_id, venue_id)
);

-- Which departments may be seated in this version-venue; no rows = no restriction.
CREATE TABLE seating_plan_venue_departments (
  id                SERIAL PRIMARY KEY,
  version_venue_id  INTEGER NOT NULL REFERENCES seating_plan_version_venues(id) ON DELETE CASCADE,
  department_id     INTEGER NOT NULL REFERENCES departments(id),
  UNIQUE (version_venue_id, department_id)
);

-- version_id nullable: the older bulk allocate()/clear() flow against
-- hall_plans directly keeps working unversioned.
ALTER TABLE seating_arrangements ADD COLUMN version_id INTEGER REFERENCES seating_plan_versions(id);
ALTER TABLE seating_arrangements ADD COLUMN is_special_accommodation BOOLEAN NOT NULL DEFAULT false;

COMMIT;
