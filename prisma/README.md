# Manual migration — run this yourself against Supabase

**Nothing here runs automatically.** No `prisma migrate deploy`, no `db push`, no `db execute` — per your standing instruction, this file is the only thing that touches Supabase, and only when you run it yourself (SQL editor or `psql`). Once you confirm it's run, tell me and I'll update `schema.prisma` and the application code to match.

## Status

| Section | Adds | For | Status |
|---|---|---|---|
| 1 | `attendance_records.photo_url` | photo proof on an attendance record | ✅ applied |
| 2 | `feedback_rating_scales`, `feedback_rating_scale_options`, `feedback_faculty_responses` + `feedback_forms.form_type`/`rating_scale_id` | end-semester feedback matrix | ✅ applied |
| 3 | `od_teams.team_name/reason/venue/from_date/to_date/from_time/to_time/faculty_guide_id` | OD team detail fields | ✅ applied |
| 4 | `student_leaves.also_on_hostel_leave/routed_to_warden/approved_by_warden_user_id` + `warden_approved` status value | hostel-tab leave routing | ✅ applied |
| 5 | `campus_outing_requests` table | campus gate pass (all students, Advisor → HoD) | ⬜ **pending — run this** |

Sections 1–4 are already live and the application code for them is already built and shipped. Only **section 5** below is new and needs running.

## Section 5 — campus gate pass, in plain terms

You asked: the In/Out tab should work for day scholars too, not just hostellers, and route through the Advisor then the HoD — not the Warden. A first draft of this reused `student_leaves` (two nullable time columns, `start_time IS NOT NULL` meaning "this row is a gate pass"). On reflection that's the wrong call here — unlike the hostel-leave routing (section 4), where both paths were *the same kind* of request (a multi-day absence) and only the approver differed, a same-day gate pass and a multi-day leave are genuinely different *shapes* of request (time-of-day matters, a date range doesn't) that just happen to share an approval chain. Telling them apart by whether one column happens to be null is exactly the kind of thing that gets confusing later, so this is a **new table** instead.

**`campus_outing_requests`** — deliberately separate from both:
- `student_leaves` — different request shape (has `start_time`/`return_time`; a leave never does), but reuses its exact `student_leave_status_enum` (`pending → faculty_approved → hod_approved`/`rejected` — `warden_approved` is simply never set here) and the same two-stage Faculty (Advisor) → HoD approval semantics as `student-leaves.service.ts`'s `facultyApprove`/`hodApprove`, just on its own table with its own approve endpoints.
- `hostel_outings` — same request shape (`start_time` required, `return_time` optional, both `TIME(6)`), but open to every student, not just hostellers, and decided by the Advisor/HoD, not the Warden.

## Run this

```sql
-- ============================================================
-- 5. campus_outing_requests — campus gate pass, open to every student,
--    Advisor -> HoD approval (separate from student_leaves and from
--    hostel_outings — see explanation above)
-- ============================================================
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

ALTER TABLE "campus_outing_requests" ADD CONSTRAINT "campus_outing_requests_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE "campus_outing_requests" ADD CONSTRAINT "campus_outing_requests_approved_by_faculty_id_fkey" FOREIGN KEY ("approved_by_faculty_id") REFERENCES "faculty"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE "campus_outing_requests" ADD CONSTRAINT "campus_outing_requests_approved_by_hod_user_id_fkey" FOREIGN KEY ("approved_by_hod_user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
```

## After you run it

Tell me and I'll:
1. Add the `campus_outing_requests` model to `schema.prisma` and regenerate the client.
2. Build a new module mirroring `student-leaves`/`me-leaves` (student-side create/list under `me-profile`, staff-side `facultyApprove`/`hodApprove` endpoints) — same shape as those, just against this table, open to every student.
3. Rework `/student/inout` (currently "In / out hostel", backed by `hostel_outings` — Warden-only, hostellers-only) to post/read through the new endpoints instead, renamed to "In / out", with Advisor → HoD status labels instead of Warden ones.
4. Leave the Hostel page's own "Outing" tab (and `hostel_outings` generally) completely untouched — that's a genuinely different, still-hostel-specific, still-Warden-decided concept (leaving the hostel building), separate from this campus-wide gate pass.
5. Add `campus_outing_requests` to `prisma/seed.sql`'s `TRUNCATE` list (not done yet — the table doesn't exist until you run this).

## Not covered here — a decision still open

Supabase already has a migration called `add_feedback_management`, applied by someone else, that built an entirely different feedback system live (`feedback_assignments`, `feedback_question_templates`, its own rating-label/course-type enums) — a different architecture from the matrix in section 2. You said we'll go with my approach for feedback, so section 2 is unaffected — but that other system still exists in the database, unused by anything in this repo. Worth deciding later whether to leave it alone, adopt it instead, or remove it — just flagging it's still there.
