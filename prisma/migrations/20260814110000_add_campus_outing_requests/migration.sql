-- CreateTable
-- Deliberately a separate table from student_leaves (unlike the
-- routed_to_warden addition) - a campus outing request is a genuinely
-- different shape of request from a leave (time-of-day matters, a date
-- range doesn't), it just happens to share the same two-stage Faculty ->
-- HoD approval chain. Also deliberately separate from hostel_outings -
-- open to every student (not just hostellers) and decided by the Faculty
-- mentor/HoD, not the Warden. Reuses student_leave_status_enum as-is
-- ('warden_approved' is simply never set here) rather than adding a near-
-- duplicate enum, and mirrors hostel_outings' own start_time/return_time
-- shape (TIME(6), start_time required, return_time optional).
CREATE TABLE "campus_outing_requests" (
    "id" SERIAL NOT NULL,
    "student_id" INTEGER NOT NULL,
    "from_date" DATE NOT NULL,
    "to_date" DATE NOT NULL,
    "start_time" TIME(6) NOT NULL,
    "return_time" TIME(6),
    "reason" VARCHAR(255),
    "status" "student_leave_status_enum" NOT NULL DEFAULT 'pending',
    "approved_by_faculty_id" INTEGER,
    "approved_by_hod_user_id" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "campus_outing_requests_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "campus_outing_requests" ADD CONSTRAINT "campus_outing_requests_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "campus_outing_requests" ADD CONSTRAINT "campus_outing_requests_approved_by_faculty_id_fkey" FOREIGN KEY ("approved_by_faculty_id") REFERENCES "faculty"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "campus_outing_requests" ADD CONSTRAINT "campus_outing_requests_approved_by_hod_user_id_fkey" FOREIGN KEY ("approved_by_hod_user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
