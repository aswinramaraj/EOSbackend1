-- ============================================================================
-- Secretary Portal completion migration
-- ============================================================================
-- Purpose: unblock the remaining 9 fake-data Secretary Portal screens
-- (Documents, Outpass, Meetings & MoM, Events & Workshops, Accreditation/NBA,
-- Settings, and the 5 employee-self-service tables whose faculty_id FK is
-- currently required-not-null).
--
-- Everything here is purely ADDITIVE:
--   - New tables only (Documents, Outpass, Meetings, Events, Accreditation,
--     Settings) — no existing table is touched.
--   - The 5 ALTER TABLE statements at the bottom only RELAX a constraint
--     (faculty_id Int -> Int?, i.e. NOT NULL -> NULL) and ADD a new nullable
--     column (staff_user_id) — no existing row is modified, no column is
--     dropped, no data is deleted. Every existing Faculty-authored row keeps
--     its faculty_id exactly as-is.
--
-- Run this against the real dev database yourself (e.g. via `psql` or
-- Supabase's SQL editor), then run `npx prisma db pull` (or manually add the
-- matching models to schema.prisma) so Prisma's client regenerates to match.
-- I have NOT run this and will not run it — this file is for your review.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1) DOCUMENTS — department-wide document register
-- ----------------------------------------------------------------------------
-- Backs: Secretary Portal "Department Document Management" screen
-- (docs/page.tsx) — course files, lab records, circulars, with a real
-- verify/unverify workflow (the existing faculty_documents table is
-- per-faculty personal documents, wrong audience for this screen).

CREATE TYPE department_document_status_enum AS ENUM ('pending', 'verified', 'missing');

CREATE TABLE department_documents (
  id                  SERIAL PRIMARY KEY,
  department_id       INTEGER NOT NULL REFERENCES departments(id),
  name                VARCHAR(255) NOT NULL,
  category             VARCHAR(50) NOT NULL, -- 'Course file' | 'Lab record' | 'Circular' | 'Accreditation' | 'Meeting'
  file_url            VARCHAR(500),
  file_key             VARCHAR(500),
  size_bytes           BIGINT,
  status               department_document_status_enum NOT NULL DEFAULT 'pending',
  version              INTEGER NOT NULL DEFAULT 1,
  uploaded_by_user_id  INTEGER NOT NULL REFERENCES users(id),
  verified_by_user_id  INTEGER REFERENCES users(id),
  verified_at          TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_department_documents_department ON department_documents(department_id);


-- ----------------------------------------------------------------------------
-- 2) STUDENT OUTPASS — same-day gate pass workflow
-- ----------------------------------------------------------------------------
-- Backs: Secretary Portal "Student Outpass" screen (outpass/page.tsx).
-- Deliberately its own table, not repurposed student_leaves (that models
-- multi-day leave, not a same-day timed gate exit) or hostel_outings
-- (hostel-resident-only, wrong audience — day scholars need this too).

CREATE TYPE outpass_status_enum AS ENUM ('pending', 'approved', 'rejected');

CREATE TABLE student_outpasses (
  id                  SERIAL PRIMARY KEY,
  student_id          INTEGER NOT NULL REFERENCES students(id),
  kind                VARCHAR(50) NOT NULL, -- 'Medical' | 'Placement drive' | 'Personal' | 'Family emergency' | ...
  outpass_date        DATE NOT NULL,
  from_time           TIME NOT NULL,
  to_time             TIME NOT NULL,
  reason              TEXT NOT NULL,
  parent_contact       VARCHAR(20),
  status               outpass_status_enum NOT NULL DEFAULT 'pending',
  approved_by_user_id  INTEGER REFERENCES users(id),
  approved_at          TIMESTAMPTZ,
  created_by_user_id   INTEGER NOT NULL REFERENCES users(id),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_student_outpasses_student ON student_outpasses(student_id);


-- ----------------------------------------------------------------------------
-- 3) MEETINGS & MINUTES OF MEETING
-- ----------------------------------------------------------------------------
-- Backs: Secretary Portal "Meeting & MoM Management" screen (meetings/page.tsx).

CREATE TYPE mom_status_enum AS ENUM ('scheduled', 'recorded', 'circulated');

CREATE TABLE department_meetings (
  id                  SERIAL PRIMARY KEY,
  department_id       INTEGER NOT NULL REFERENCES departments(id),
  title               VARCHAR(255) NOT NULL,
  meeting_at          TIMESTAMPTZ NOT NULL,
  venue               VARCHAR(150),
  chair_user_id       INTEGER REFERENCES users(id),
  invitee_count       INTEGER NOT NULL DEFAULT 0,
  mom_status          mom_status_enum NOT NULL DEFAULT 'scheduled',
  mom_text            TEXT,
  created_by_user_id  INTEGER NOT NULL REFERENCES users(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_department_meetings_department ON department_meetings(department_id);

CREATE TABLE meeting_action_items (
  id          SERIAL PRIMARY KEY,
  meeting_id  INTEGER NOT NULL REFERENCES department_meetings(id) ON DELETE CASCADE,
  label       VARCHAR(255) NOT NULL,
  done        BOOLEAN NOT NULL DEFAULT false
);
CREATE INDEX idx_meeting_action_items_meeting ON meeting_action_items(meeting_id);


-- ----------------------------------------------------------------------------
-- 4) EVENTS & WORKSHOPS (with registrations/capacity)
-- ----------------------------------------------------------------------------
-- Backs: Secretary Portal "Event & Workshop Coordination" screen
-- (events/page.tsx). Distinct from venue_bookings (a room-approval flow with
-- no registration counter) and edc_events (locked to EDC Coordinator only).

CREATE TYPE department_event_status_enum AS ENUM ('planning', 'awaiting_approval', 'approved', 'completed');

CREATE TABLE department_events (
  id                  SERIAL PRIMARY KEY,
  department_id       INTEGER NOT NULL REFERENCES departments(id),
  title               VARCHAR(255) NOT NULL,
  kind                VARCHAR(100) NOT NULL, -- 'Workshop' | 'Guest lecture' | 'Symposium' | 'Panel' | 'Industrial visit'
  event_date          VARCHAR(50) NOT NULL,   -- free-text date/range to match the design ("22-23 Aug")
  venue_id            INTEGER REFERENCES venues(id),
  owner_faculty_id     INTEGER REFERENCES faculty(id),
  status               department_event_status_enum NOT NULL DEFAULT 'planning',
  registrations        INTEGER NOT NULL DEFAULT 0,
  capacity             INTEGER NOT NULL,
  created_by_user_id   INTEGER NOT NULL REFERENCES users(id),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_department_events_department ON department_events(department_id);


-- ----------------------------------------------------------------------------
-- 5) ACCREDITATION / NBA CRITERIA & EVIDENCE
-- ----------------------------------------------------------------------------
-- Backs: Secretary Portal "Accreditation Documentation" screen
-- (accreditation/page.tsx).

CREATE TABLE nba_criteria (
  id            SERIAL PRIMARY KEY,
  department_id INTEGER NOT NULL REFERENCES departments(id),
  code          VARCHAR(30) NOT NULL,   -- 'Criterion 1' etc.
  name          VARCHAR(255) NOT NULL,
  max_marks     INTEGER NOT NULL,
  sort_order    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_nba_criteria_department ON nba_criteria(department_id);

CREATE TABLE nba_evidence_items (
  id            SERIAL PRIMARY KEY,
  criterion_id  INTEGER NOT NULL REFERENCES nba_criteria(id) ON DELETE CASCADE,
  label         VARCHAR(255) NOT NULL,
  done          BOOLEAN NOT NULL DEFAULT false,
  updated_by_user_id INTEGER REFERENCES users(id),
  updated_at    TIMESTAMPTZ
);
CREATE INDEX idx_nba_evidence_items_criterion ON nba_evidence_items(criterion_id);


-- ----------------------------------------------------------------------------
-- 6) PER-USER SETTINGS / PREFERENCES
-- ----------------------------------------------------------------------------
-- Backs: Secretary Portal "Settings" screen (settings/page.tsx). Fixed
-- boolean columns rather than a generic key/value table, since the design
-- has exactly 4 named toggles and a flexible schema isn't needed yet.

CREATE TABLE user_preferences (
  user_id                     INTEGER PRIMARY KEY REFERENCES users(id),
  daily_attendance_digest     BOOLEAN NOT NULL DEFAULT true,
  sop_escalation_alerts       BOOLEAN NOT NULL DEFAULT true,
  auto_circulate_mom          BOOLEAN NOT NULL DEFAULT false,
  compact_tables              BOOLEAN NOT NULL DEFAULT false,
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- ----------------------------------------------------------------------------
-- 7) EMPLOYEE SELF-SERVICE — let a Secretary (or any non-teaching staff
--    account) use the 5 tables that currently require a `faculty` row
-- ----------------------------------------------------------------------------
-- Each ALTER only relaxes faculty_id to nullable and adds a nullable
-- staff_user_id (a plain users.id FK every account has) as the alternate
-- identity path — mirrors the exact pattern already used for
-- media_requests.requested_by_faculty_id / attendance_records.
-- marked_by_faculty_id (both already nullable in the live schema).
-- No existing Faculty-authored row is touched; the app-layer service code
-- would branch on role exactly like MediaRequestsService/AttendanceService
-- already do, so this is intentionally the SAME migration shape as those
-- two tables' pre-existing nullable columns — just applied to the other 5.

ALTER TABLE faculty_daily_attendance
  ALTER COLUMN faculty_id DROP NOT NULL,
  ADD COLUMN staff_user_id INTEGER REFERENCES users(id);

ALTER TABLE faculty_leaves
  ALTER COLUMN faculty_id DROP NOT NULL,
  ADD COLUMN staff_user_id INTEGER REFERENCES users(id);

ALTER TABLE faculty_od_requests
  ALTER COLUMN faculty_id DROP NOT NULL,
  ADD COLUMN staff_user_id INTEGER REFERENCES users(id);

ALTER TABLE appraisal_requests
  ALTER COLUMN faculty_id DROP NOT NULL,
  ADD COLUMN staff_user_id INTEGER REFERENCES users(id);

ALTER TABLE payslip_requests
  ALTER COLUMN faculty_id DROP NOT NULL,
  ADD COLUMN staff_user_id INTEGER REFERENCES users(id);

-- Library: add a 'staff' value to the borrower-type enum (Postgres requires
-- this as its own statement, run in its own transaction, before any table
-- can use the new value in the same session).
ALTER TYPE borrower_type_enum ADD VALUE IF NOT EXISTS 'staff';

ALTER TABLE book_borrow_records
  ADD COLUMN staff_user_id INTEGER REFERENCES users(id);

-- ============================================================================
-- End of migration.
-- ============================================================================
