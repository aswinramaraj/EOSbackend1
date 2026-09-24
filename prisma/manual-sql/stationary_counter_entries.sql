-- Counter/walk-in print jobs - a Stationary vendor logging an in-person job
-- with no linked student/staff account (just a typed name/department), per
-- the Stationery Portal design's "Add entry" flow. user_id was NOT NULL;
-- relaxed to nullable so a walk-in row can omit it entirely rather than
-- being forced to attribute it to some other real account. Existing rows
-- (all of which DO have a real user_id) are completely unaffected.
ALTER TABLE stationary_requests ALTER COLUMN user_id DROP NOT NULL;

ALTER TABLE stationary_requests
  ADD COLUMN IF NOT EXISTS walkin_requester_name VARCHAR(150),
  ADD COLUMN IF NOT EXISTS walkin_department VARCHAR(150);

-- A row is a walk-in exactly when user_id IS NULL - enforce the two states
-- can't both go missing (a row must be attributable to *someone*, online
-- account or a typed walk-in name).
ALTER TABLE stationary_requests DROP CONSTRAINT IF EXISTS stationary_requests_requester_check;
ALTER TABLE stationary_requests ADD CONSTRAINT stationary_requests_requester_check
  CHECK (user_id IS NOT NULL OR walkin_requester_name IS NOT NULL);
