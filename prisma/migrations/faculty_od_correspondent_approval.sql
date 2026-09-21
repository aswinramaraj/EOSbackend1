-- Principal has no faculty row and no HoD/HR Payroll reviewing them, so
-- their own OD requests need an independent "management" approval stage -
-- mirrors faculty_leaves.correspondent_approval_status (see that table's
-- own migration/schema entry) exactly, for faculty_od_requests.
ALTER TABLE faculty_od_requests
  ADD COLUMN IF NOT EXISTS correspondent_approval_status approval_status_enum,
  ADD COLUMN IF NOT EXISTS correspondent_decided_by_user_id INTEGER,
  ADD COLUMN IF NOT EXISTS correspondent_decided_at TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS correspondent_remarks VARCHAR(255);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'faculty_od_requests_correspondent_decider_fkey'
  ) THEN
    ALTER TABLE faculty_od_requests
      ADD CONSTRAINT faculty_od_requests_correspondent_decider_fkey
      FOREIGN KEY (correspondent_decided_by_user_id) REFERENCES users(id);
  END IF;
END $$;
