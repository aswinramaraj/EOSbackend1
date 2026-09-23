-- HoD -> Faculty feedback. Run this yourself (Supabase SQL editor / psql).
--
-- Until now a HoD could only create feedback forms for STUDENTS
-- (feedback_forms / feedback_responses, which are keyed to students.id).
-- This adds the faculty equivalent: a HoD posts a form to every faculty
-- member of their own department, and each faculty member answers it once
-- from their Campus tab. Purely additive - no existing table is changed.
-- Reuses the existing feedback_question_type_enum ('rating' | 'text').

CREATE TABLE "faculty_feedback_forms" (
    "id" SERIAL PRIMARY KEY,
    "created_by_user_id" INTEGER NOT NULL REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
    "department_id" INTEGER NOT NULL REFERENCES "departments"("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
    "title" VARCHAR(200) NOT NULL,
    "is_published" BOOLEAN NOT NULL DEFAULT TRUE,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);
CREATE INDEX "idx_faculty_feedback_forms_department" ON "faculty_feedback_forms"("department_id");

CREATE TABLE "faculty_feedback_questions" (
    "id" SERIAL PRIMARY KEY,
    "form_id" INTEGER NOT NULL REFERENCES "faculty_feedback_forms"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
    "question_text" TEXT NOT NULL,
    "sequence_no" SMALLINT,
    "question_type" "feedback_question_type_enum" NOT NULL DEFAULT 'rating'
);
CREATE INDEX "idx_faculty_feedback_questions_form" ON "faculty_feedback_questions"("form_id");

CREATE TABLE "faculty_feedback_responses" (
    "id" SERIAL PRIMARY KEY,
    "question_id" INTEGER NOT NULL REFERENCES "faculty_feedback_questions"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
    "faculty_id" INTEGER NOT NULL REFERENCES "faculty"("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
    "rating_value" SMALLINT CHECK ("rating_value" BETWEEN 1 AND 5),
    "response_text" TEXT,
    "submitted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    CONSTRAINT "faculty_feedback_responses_question_faculty_key" UNIQUE ("question_id", "faculty_id")
);
CREATE INDEX "idx_faculty_feedback_responses_faculty" ON "faculty_feedback_responses"("faculty_id");
