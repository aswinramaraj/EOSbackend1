-- AlterEnum
-- New terminal status for a leave that skips faculty/HoD and is decided by
-- the warden directly. Existing values (pending/faculty_approved/
-- hod_approved/rejected) are untouched - this only adds a value, so every
-- existing row and every existing status check keeps working unchanged.
ALTER TYPE "student_leave_status_enum" ADD VALUE IF NOT EXISTS 'warden_approved';

-- AlterTable
-- also_on_hostel_leave: informational only. Set on a normal academic-tab
-- leave (routed_to_warden = false) when the student is also a hostel
-- resident who will be away - lets the warden dashboard show its status
-- read-only, without the warden ever approving/rejecting it here.
--
-- routed_to_warden: the actual routing switch. false (default) = today's
-- unchanged student -> faculty (mentor) -> HoD chain. true = set only by
-- the new Hostel-tab leave flow; this leave is decided by the warden alone
-- (approved_by_warden_user_id + status transitions straight from 'pending'
-- to 'warden_approved'/'rejected'), and must never be surfaced in the
-- faculty mentor or HoD review queues.
--
-- approved_by_warden_user_id: mirrors hostel_outings.approved_by_warden_user_id
-- exactly (same type, same nullability, same FK target) - the warden's
-- decision on a routed_to_warden=true row.
ALTER TABLE "student_leaves" ADD COLUMN     "also_on_hostel_leave" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "routed_to_warden" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "approved_by_warden_user_id" INTEGER;

-- AddForeignKey
ALTER TABLE "student_leaves" ADD CONSTRAINT "student_leaves_approved_by_warden_user_id_fkey" FOREIGN KEY ("approved_by_warden_user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
