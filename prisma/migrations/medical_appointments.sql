-- ============================================================================
--  Medical centre: appointment booking (time parts -> 30-min slots -> approval)
-- ============================================================================
--  Three-step workflow this supports:
--
--   1. Medical staff opens one or more "time parts" on a date
--      (e.g. 10:00-13:00 and 14:00-16:00)         -> medical_appointment_windows
--   2. Each window is divided into fixed-length slots (30 min by default).
--      Slots are DERIVED, never stored: start_time + n * slot_minutes. Storing
--      them would duplicate state that can be recomputed exactly, and would go
--      stale the moment a window is edited.
--   3. Any authenticated non-parent user books one slot. A booking lands as
--      'pending' and does NOT enter the OPD queue. Only when medical staff
--      approves it is a medical_visits row created (status 'waiting') and
--      linked back via medical_appointments.visit_id.
--
--  Capacity is per derived slot (default 10 people per 30 min), held on the
--  window so staff can vary it per session rather than it being hardcoded.
--
--  Safe to re-run.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Time parts ("windows") a medical staff member opens on a given date
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS medical_appointment_windows (
  id                 SERIAL      PRIMARY KEY,
  slot_date          DATE        NOT NULL,
  start_time         TIME        NOT NULL,
  end_time           TIME        NOT NULL,
  slot_minutes       SMALLINT    NOT NULL DEFAULT 30,
  capacity_per_slot  SMALLINT    NOT NULL DEFAULT 10,
  status             VARCHAR(20) NOT NULL DEFAULT 'open',
  created_by_user_id INTEGER     NOT NULL REFERENCES users(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT medical_appointment_windows_time_order_check
    CHECK (end_time > start_time),

  CONSTRAINT medical_appointment_windows_slot_minutes_check
    CHECK (slot_minutes IN (10, 15, 20, 30, 60)),

  CONSTRAINT medical_appointment_windows_capacity_check
    CHECK (capacity_per_slot BETWEEN 1 AND 200),

  CONSTRAINT medical_appointment_windows_status_check
    CHECK (status IN ('open', 'closed')),

  -- A window must divide into whole slots. 10:00-12:45 at 30 min would leave a
  -- ragged 15-min tail that has no defined capacity, so it is rejected here as
  -- well as in the API (which returns a readable message instead of this).
  CONSTRAINT medical_appointment_windows_divisible_check
    CHECK (MOD(EXTRACT(EPOCH FROM (end_time - start_time))::INTEGER, slot_minutes * 60) = 0),

  -- Blocks the exact same time part being added twice on one date. Partial
  -- OVERLAP (10:00-13:00 vs 12:00-14:00) is rejected by the API inside a
  -- transaction that locks the date; see the optional hardening block at the
  -- bottom of this file for a database-level guarantee.
  CONSTRAINT medical_appointment_windows_unique
    UNIQUE (slot_date, start_time, end_time)
);

COMMENT ON TABLE medical_appointment_windows IS
  'One row per time part medical staff opens for appointments on a date. The bookable 30-min slots inside it are derived (start_time + n * slot_minutes), never stored.';
COMMENT ON COLUMN medical_appointment_windows.capacity_per_slot IS
  'Maximum live (pending + approved) bookings allowed in each derived slot. Defaults to 10.';
COMMENT ON COLUMN medical_appointment_windows.status IS
  'open = accepting bookings; closed = staff stopped intake, existing bookings stand.';

CREATE INDEX IF NOT EXISTS idx_medical_appointment_windows_date
  ON medical_appointment_windows (slot_date);

-- ---------------------------------------------------------------------------
-- 2. Bookings against a derived slot
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS medical_appointments (
  id                 SERIAL      PRIMARY KEY,
  window_id          INTEGER     NOT NULL REFERENCES medical_appointment_windows(id) ON DELETE RESTRICT,

  -- Denormalised from the window on insert so slot-level capacity counting and
  -- the per-user uniqueness index below need no join. The API always derives
  -- these from the window row, never from client input.
  slot_date          DATE        NOT NULL,
  slot_start         TIME        NOT NULL,
  slot_end           TIME        NOT NULL,

  -- Who pressed Book. Taken from the JWT server-side, never from the request
  -- body, so one user can never book in another name.
  booked_by_user_id  INTEGER     NOT NULL REFERENCES users(id),

  -- Reuses borrower_type_enum (student | faculty | staff) so approval can copy
  -- straight into medical_visits.visitor_type with no translation table.
  patient_kind       borrower_type_enum NOT NULL,
  student_id         INTEGER     NULL REFERENCES students(id),
  faculty_id         INTEGER     NULL REFERENCES faculty(id),
  staff_id           INTEGER     NULL REFERENCES non_teaching_staff(id),

  reason             VARCHAR(255) NULL,
  status             VARCHAR(20)  NOT NULL DEFAULT 'pending',

  decided_by_user_id INTEGER     NULL REFERENCES users(id),
  decided_at         TIMESTAMPTZ NULL,
  decision_note      VARCHAR(255) NULL,

  -- Set only on approval: the OPD queue row this booking became. NULL for
  -- everything still pending, rejected or cancelled -- which is exactly the
  -- "not directly in the queue" rule, enforced by data rather than by code.
  visit_id           INTEGER     NULL REFERENCES medical_visits(id),

  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT medical_appointments_status_check
    CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),

  CONSTRAINT medical_appointments_slot_order_check
    CHECK (slot_end > slot_start),

  -- Exactly one patient identity, and it must agree with patient_kind.
  CONSTRAINT medical_appointments_patient_identity_check CHECK (
       (patient_kind = 'student' AND student_id IS NOT NULL AND faculty_id IS NULL AND staff_id IS NULL)
    OR (patient_kind = 'faculty' AND faculty_id IS NOT NULL AND student_id IS NULL AND staff_id IS NULL)
    OR (patient_kind = 'staff'   AND staff_id   IS NOT NULL AND student_id IS NULL AND faculty_id IS NULL)
  ),

  -- An approved or rejected row must say who decided it and when.
  CONSTRAINT medical_appointments_decision_check CHECK (
    status IN ('pending', 'cancelled')
    OR (decided_by_user_id IS NOT NULL AND decided_at IS NOT NULL)
  ),

  -- Only an approved booking may point at an OPD visit.
  CONSTRAINT medical_appointments_visit_link_check CHECK (
    visit_id IS NULL OR status = 'approved'
  )
);

COMMENT ON TABLE medical_appointments IS
  'One booking of one derived 30-min slot. Stays out of the OPD queue until medical staff approves it, at which point visit_id points at the medical_visits row created for it.';
COMMENT ON COLUMN medical_appointments.booked_by_user_id IS
  'Authenticated booker, resolved from the JWT server-side. Never accepted from the request body.';
COMMENT ON COLUMN medical_appointments.visit_id IS
  'The OPD queue row this booking became on approval. NULL while pending/rejected/cancelled.';

-- One live booking per person per slot. Partial, so a rejected or cancelled
-- attempt does not block re-booking the same slot later.
CREATE UNIQUE INDEX IF NOT EXISTS uq_medical_appointments_active_per_user_slot
  ON medical_appointments (slot_date, slot_start, booked_by_user_id)
  WHERE status IN ('pending', 'approved');

CREATE INDEX IF NOT EXISTS idx_medical_appointments_window
  ON medical_appointments (window_id);

-- Serves both the per-slot capacity count and the staff booking list.
CREATE INDEX IF NOT EXISTS idx_medical_appointments_slot_status
  ON medical_appointments (slot_date, slot_start, status);

-- Serves "my appointments" for the logged-in booker.
CREATE INDEX IF NOT EXISTS idx_medical_appointments_booker
  ON medical_appointments (booked_by_user_id, slot_date DESC);

-- ---------------------------------------------------------------------------
-- 3. medical_visits: name a non-teaching-staff patient
-- ---------------------------------------------------------------------------
--  medical_visits.visitor_type is already borrower_type_enum, whose third
--  value is 'staff' -- but the table only ever had student_id and faculty_id,
--  so a staff visit had no way to record WHO. That pre-existing gap now
--  matters, because Secretary/HR/warden users are non_teaching_staff rows, not
--  faculty rows (see HrPayrollService.resolveStaffByUserId), and they can book.
--
--  Additive and nullable: every existing row keeps staff_id = NULL and behaves
--  exactly as before.
-- ---------------------------------------------------------------------------
ALTER TABLE medical_visits
  ADD COLUMN IF NOT EXISTS staff_id INTEGER NULL REFERENCES non_teaching_staff(id);

COMMENT ON COLUMN medical_visits.staff_id IS
  'Non-teaching staff patient, used when visitor_type = staff. NULL for student/faculty visits.';

CREATE INDEX IF NOT EXISTS idx_medical_visits_staff
  ON medical_visits (staff_id);

COMMIT;


-- ============================================================================
--  OPTIONAL HARDENING -- run separately, only if you want overlapping time
--  parts refused by the database as well as by the API.
-- ============================================================================
--  The API already refuses an overlapping window inside a transaction that
--  takes an advisory lock on the date, so this is defence in depth, not a
--  requirement. It needs the btree_gist extension (available on Supabase) in
--  order to mix an equality column with a range column in one EXCLUDE.
--
--  Skip this block entirely if you would rather not add an extension.
-- ============================================================================

-- BEGIN;
--
-- CREATE EXTENSION IF NOT EXISTS btree_gist;
--
-- ALTER TABLE medical_appointment_windows
--   ADD CONSTRAINT medical_appointment_windows_no_overlap
--   EXCLUDE USING gist (
--     slot_date WITH =,
--     numrange(
--       (EXTRACT(EPOCH FROM start_time) / 60)::NUMERIC,
--       (EXTRACT(EPOCH FROM end_time)   / 60)::NUMERIC
--     ) WITH &&
--   );
--
-- COMMIT;
