-- CreateEnum
CREATE TYPE "od_verification_status_enum" AS ENUM ('awaiting_documents', 'under_review', 'verified');

-- AlterTable
ALTER TABLE "venue_bookings"
  ADD COLUMN     "description" TEXT,
  ADD COLUMN     "requirements" TEXT[],
  ADD COLUMN     "admin_remarks" TEXT,
  ADD COLUMN     "reviewed_at" TIMESTAMPTZ(6);

-- AlterTable
ALTER TABLE "od_requests"
  ADD COLUMN     "organization" VARCHAR(255),
  ADD COLUMN     "location" VARCHAR(255),
  ADD COLUMN     "latitude" DECIMAL(10,6),
  ADD COLUMN     "longitude" DECIMAL(10,6),
  ADD COLUMN     "photo_url" VARCHAR(500),
  ADD COLUMN     "photo_uploaded_at" TIMESTAMPTZ(6),
  ADD COLUMN     "certificate_url" VARCHAR(500),
  ADD COLUMN     "certificate_uploaded_at" TIMESTAMPTZ(6),
  ADD COLUMN     "verification_status" "od_verification_status_enum" NOT NULL DEFAULT 'awaiting_documents',
  ADD COLUMN     "email_sender" VARCHAR(255),
  ADD COLUMN     "email_receiver" VARCHAR(255),
  ADD COLUMN     "email_subject" VARCHAR(255),
  ADD COLUMN     "email_sent_at" TIMESTAMPTZ(6),
  ADD COLUMN     "email_body" TEXT,
  ADD COLUMN     "admin_remarks" TEXT;

-- AlterTable
ALTER TABLE "faculty_od_requests"
  ADD COLUMN     "organization_visited" VARCHAR(255),
  ADD COLUMN     "students_guided" INTEGER,
  ADD COLUMN     "sanction_order" VARCHAR(100),
  ADD COLUMN     "latitude" DECIMAL(10,6),
  ADD COLUMN     "longitude" DECIMAL(10,6),
  ADD COLUMN     "photo_url" VARCHAR(500),
  ADD COLUMN     "photo_uploaded_at" TIMESTAMPTZ(6),
  ADD COLUMN     "certificate_url" VARCHAR(500),
  ADD COLUMN     "certificate_uploaded_at" TIMESTAMPTZ(6),
  ADD COLUMN     "verification_status" "od_verification_status_enum" NOT NULL DEFAULT 'awaiting_documents',
  ADD COLUMN     "email_sender" VARCHAR(255),
  ADD COLUMN     "email_receiver" VARCHAR(255),
  ADD COLUMN     "email_subject" VARCHAR(255),
  ADD COLUMN     "email_sent_at" TIMESTAMPTZ(6),
  ADD COLUMN     "email_body" TEXT,
  ADD COLUMN     "admin_remarks" TEXT;
