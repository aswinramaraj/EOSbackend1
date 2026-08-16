-- Genuine schema gaps confirmed during the exhaustive Department-section
-- audit (Bulk Attendance / Students / Documents / Department Details).
-- Grepped the whole 267-model schema for each of these — none exist
-- anywhere under any name. Purely additive, no existing table/column
-- touched. I have not run this and will not run it myself, per the
-- standing rule. Run it yourself, then `npx prisma db pull` +
-- `npx prisma generate` same as every prior migration this session.

-- ── Bulk Attendance: "who changed this mark" audit trail ───────────────
-- Real gap: attendance_records has no history table, so there's no way
-- to know if/when/by-whom a mark was ever changed after the fact.
CREATE TABLE attendance_record_changes (
  id BIGSERIAL PRIMARY KEY,
  attendance_record_id INT NOT NULL REFERENCES attendance_records(id) ON DELETE CASCADE,
  from_status attendance_status_enum,
  to_status attendance_status_enum NOT NULL,
  changed_by_user_id INT NOT NULL REFERENCES users(id),
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_attendance_record_changes_record ON attendance_record_changes(attendance_record_id);
ALTER TABLE attendance_records ADD COLUMN updated_at TIMESTAMPTZ;

-- ── Students: class representative flag ────────────────────────────────
ALTER TABLE students ADD COLUMN is_class_rep BOOLEAN NOT NULL DEFAULT false;

-- ── Students: open escalations (no generic student-issue table exists —
-- hostel_complaints is a different, residential-only domain) ──────────
CREATE TABLE student_escalations (
  id SERIAL PRIMARY KEY,
  student_id INT REFERENCES students(id),
  class_id INT REFERENCES classes(id),
  title VARCHAR(255) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'open', -- open / in_progress / resolved
  owner_user_id INT REFERENCES users(id),
  raised_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  notes TEXT
);

-- ── Department Details: per-programme accreditation status ────────────
ALTER TABLE courses ADD COLUMN accreditation_status VARCHAR(30);
-- e.g. 'accredited' | 'applied' | 'not_applied' | 'expired'
ALTER TABLE courses ADD COLUMN accreditation_valid_until DATE;

-- ── Department Details: Laboratories & infrastructure ──────────────────
CREATE TABLE department_labs (
  id SERIAL PRIMARY KEY,
  department_id INT NOT NULL REFERENCES departments(id),
  name VARCHAR(150) NOT NULL,
  incharge_faculty_id INT REFERENCES faculty(id),
  systems_count INT,
  status VARCHAR(30) DEFAULT 'operational', -- operational / maintenance / upgrade_needed
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Department Details: MoUs signed ─────────────────────────────────────
CREATE TABLE department_mous (
  id SERIAL PRIMARY KEY,
  department_id INT NOT NULL REFERENCES departments(id),
  partner_name VARCHAR(255) NOT NULL,
  signed_date DATE,
  valid_until DATE,
  status VARCHAR(30) DEFAULT 'active',
  document_url VARCHAR(500)
);

-- ── Department Details: research funding ────────────────────────────────
CREATE TABLE department_research_funding (
  id SERIAL PRIMARY KEY,
  department_id INT NOT NULL REFERENCES departments(id),
  title VARCHAR(255) NOT NULL,
  funding_agency VARCHAR(255),
  sanctioned_amount DECIMAL(14,2),
  sanctioned_date DATE,
  status VARCHAR(30) DEFAULT 'ongoing'
);

-- ── Department Details: office location & contact ──────────────────────
ALTER TABLE departments ADD COLUMN office_location VARCHAR(255);
ALTER TABLE departments ADD COLUMN contact_phone VARCHAR(20);
ALTER TABLE departments ADD COLUMN contact_email VARCHAR(255);
