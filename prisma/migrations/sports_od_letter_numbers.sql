-- ============================================================================
--  Sports OD: sequential letter register
-- ============================================================================
--  Each printed on-duty letter needs its own sequential reference number
--  (e.g. "SECR/EXCU/SPORT/022 ON DUTY LETER 1.O 25-2026") for the physical
--  register. This table only logs *that a number was issued, to whom, and by
--  whom* — the letter's actual text (event, venue, dates) is composed fresh
--  each time from the sports OD form and the athlete's current profile, the
--  same way fee_receipt_numbers logs an issuance without storing the
--  receipt's line items.
--
--  Not tied to a specific sports_od_requests row: a letter can be generated
--  standalone, before or without an OD request ever being raised.
--
--  Safe to re-run.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS sports_od_letter_numbers (
  id                 SERIAL PRIMARY KEY,
  student_id         INTEGER     NOT NULL REFERENCES students(id),
  issued_by_user_id  INTEGER     NULL REFERENCES users(id),
  issued_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE sports_od_letter_numbers IS
  'One row per printed sports OD letter, purely for the sequential reference number (id) shown on it. Letter content is composed on demand, never stored here.';

CREATE INDEX IF NOT EXISTS idx_sports_od_letter_numbers_student
  ON sports_od_letter_numbers (student_id);

COMMIT;
