-- CreateEnum
CREATE TYPE "feedback_form_type_enum" AS ENUM ('general', 'end_semester');

-- AlterTable
ALTER TABLE "feedback_forms" ADD COLUMN     "form_type" "feedback_form_type_enum" NOT NULL DEFAULT 'general',
ADD COLUMN     "rating_scale_id" INTEGER;

-- CreateTable
CREATE TABLE "feedback_rating_scales" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feedback_rating_scales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feedback_rating_scale_options" (
    "id" SERIAL NOT NULL,
    "scale_id" INTEGER NOT NULL,
    "sequence_no" SMALLINT NOT NULL,
    "value" SMALLINT NOT NULL,
    "label" VARCHAR(100) NOT NULL,

    CONSTRAINT "feedback_rating_scale_options_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feedback_faculty_responses" (
    "id" SERIAL NOT NULL,
    "question_id" INTEGER NOT NULL,
    "student_id" INTEGER NOT NULL,
    "mapping_id" INTEGER NOT NULL,
    "faculty_id" INTEGER NOT NULL,
    "subject_id" INTEGER NOT NULL,
    "response_text" TEXT,
    "rating_value" SMALLINT,
    "submitted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feedback_faculty_responses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "feedback_rating_scale_options_scale_id_sequence_no_key" ON "feedback_rating_scale_options"("scale_id", "sequence_no");

-- CreateIndex
CREATE UNIQUE INDEX "feedback_faculty_responses_question_id_student_id_mapping_id_key" ON "feedback_faculty_responses"("question_id", "student_id", "mapping_id");

-- AddForeignKey
ALTER TABLE "feedback_forms" ADD CONSTRAINT "feedback_forms_rating_scale_id_fkey" FOREIGN KEY ("rating_scale_id") REFERENCES "feedback_rating_scales"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "feedback_rating_scale_options" ADD CONSTRAINT "feedback_rating_scale_options_scale_id_fkey" FOREIGN KEY ("scale_id") REFERENCES "feedback_rating_scales"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "feedback_faculty_responses" ADD CONSTRAINT "feedback_faculty_responses_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "feedback_questions"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "feedback_faculty_responses" ADD CONSTRAINT "feedback_faculty_responses_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "feedback_faculty_responses" ADD CONSTRAINT "feedback_faculty_responses_mapping_id_fkey" FOREIGN KEY ("mapping_id") REFERENCES "faculty_subject_class_mapping"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- Seed: default rating scale, reusing the wording already live in the flat feedback form
-- (feedback.service.ts RATING_LABELS / frontend RATING_OPTIONS), now DB-driven for the matrix UI.
INSERT INTO "feedback_rating_scales" ("id", "name") OVERRIDING SYSTEM VALUE VALUES
  (1, 'Standard 5-point');

INSERT INTO "feedback_rating_scale_options" ("id", "scale_id", "sequence_no", "value", "label") OVERRIDING SYSTEM VALUE VALUES
  (1, 1, 1, 5, 'Excellent'),
  (2, 1, 2, 4, 'Very good'),
  (3, 1, 3, 3, 'Good'),
  (4, 1, 4, 2, 'Satisfactory'),
  (5, 1, 5, 1, 'Needs improvement');

SELECT setval(pg_get_serial_sequence('"feedback_rating_scales"', 'id'), (SELECT MAX("id") FROM "feedback_rating_scales"));
SELECT setval(pg_get_serial_sequence('"feedback_rating_scale_options"', 'id'), (SELECT MAX("id") FROM "feedback_rating_scale_options"));
