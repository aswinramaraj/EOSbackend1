-- ============================================================================
-- Correspondent leave-approval migration
-- ============================================================================
-- Purpose: let a Correspondent (Management) mobile role approve/reject a
-- Principal's own leave request, independent of the existing HoD/HR Payroll
-- stages on faculty_leaves.
--
-- Purely ADDITIVE: 4 new nullable columns on the existing faculty_leaves
-- table, exactly mirroring the already-present (but previously unused by
-- faculty-leaves.service.ts) principal_approval_status/
-- principal_decided_by_user_id/principal_decided_at/principal_remarks
-- column group. No existing column is altered or dropped, no existing row
-- is modified (new columns default to NULL for every current row).
-- ============================================================================

ALTER TABLE faculty_leaves
  ADD COLUMN correspondent_approval_status approval_status_enum,
  ADD COLUMN correspondent_decided_by_user_id INTEGER REFERENCES users(id),
  ADD COLUMN correspondent_decided_at TIMESTAMPTZ,
  ADD COLUMN correspondent_remarks VARCHAR(255);
