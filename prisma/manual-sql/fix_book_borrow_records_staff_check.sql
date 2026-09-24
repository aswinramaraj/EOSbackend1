-- Fixes a real DB bug found while verifying Media Room's Library page:
-- borrower_type_enum has a 'staff' value, but the CHECK constraint that
-- enforces which FK must be set per borrower_type was never updated to
-- match — it only recognizes 'student' and 'faculty'. Any insert with
-- borrower_type = 'staff' is rejected outright, regardless of caller.
--
-- Current constraint (confirmed via pg_constraint):
--   CHECK ((borrower_type='student' AND student_id IS NOT NULL AND faculty_id IS NULL)
--       OR (borrower_type='faculty' AND faculty_id IS NOT NULL AND student_id IS NULL))
--
-- This adds the missing 'staff' branch, and tightens the other two branches
-- to also require staff_user_id IS NULL (matching the existing exclusivity
-- pattern between student_id/faculty_id).

ALTER TABLE book_borrow_records DROP CONSTRAINT book_borrow_records_check;

ALTER TABLE book_borrow_records ADD CONSTRAINT book_borrow_records_check CHECK (
  (borrower_type = 'student' AND student_id IS NOT NULL AND faculty_id IS NULL AND staff_user_id IS NULL) OR
  (borrower_type = 'faculty' AND faculty_id IS NOT NULL AND student_id IS NULL AND staff_user_id IS NULL) OR
  (borrower_type = 'staff' AND staff_user_id IS NOT NULL AND student_id IS NULL AND faculty_id IS NULL)
);
