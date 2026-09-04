-- CreateEnum
CREATE TYPE "stationary_orientation_enum" AS ENUM ('portrait', 'landscape');

-- CreateEnum
CREATE TYPE "stationary_color_mode_enum" AS ENUM ('color', 'bw');

-- CreateEnum
CREATE TYPE "stationary_pages_enum" AS ENUM ('all', 'even', 'odd');

-- CreateEnum
CREATE TYPE "stationary_request_status_enum" AS ENUM ('pending_payment', 'paid');

-- CreateTable
-- A print/xerox shop request (see amenity/stationary in the mobile app) -
-- only ever written to from the point a request actually goes to
-- checkout; the app keeps drafts on-device, per user, not here.
CREATE TABLE "stationary_requests" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "file_name" VARCHAR(255),
    "copies" INTEGER NOT NULL,
    "orientation" "stationary_orientation_enum" NOT NULL,
    "color_mode" "stationary_color_mode_enum" NOT NULL,
    "pages" "stationary_pages_enum" NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "status" "stationary_request_status_enum" NOT NULL DEFAULT 'pending_payment',
    "razorpay_order_id" VARCHAR(100),
    "razorpay_payment_id" VARCHAR(100),
    "razorpay_signature" VARCHAR(255),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stationary_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "stationary_requests_razorpay_order_id_key" ON "stationary_requests"("razorpay_order_id");

-- CreateIndex
CREATE INDEX "stationary_requests_user_id_created_at_idx" ON "stationary_requests"("user_id", "created_at");

-- AddForeignKey
ALTER TABLE "stationary_requests" ADD CONSTRAINT "stationary_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
