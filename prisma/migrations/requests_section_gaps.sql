-- Genuine schema gaps confirmed during the exhaustive Requests-section
-- audit (POP / SOP / Media Request / Venue Booking / Student Outpass).
-- Grepped the whole schema for each — none exist anywhere under any
-- name. Purely additive. I have not run this and will not run it myself,
-- per the standing rule. Run it yourself, then `npx prisma db pull` +
-- `npx prisma generate` same as every prior migration this session.

-- ── POP (purchase_indents): reference code + estimated amount ──────────
-- Real chain has no formatted request code and no money field at all
-- (only quantity). ref is generated at insert time in application code
-- once this column exists (e.g. 'POP/{dept.code}/{year}/{seq}').
ALTER TABLE purchase_indents ADD COLUMN ref VARCHAR(40);
ALTER TABLE purchase_indents ADD COLUMN estimated_amount NUMERIC(12,2);

-- Draft state + Secretary-owned edit/withdraw, matching SOP below.
ALTER TYPE indent_status_enum ADD VALUE IF NOT EXISTS 'draft';
ALTER TYPE indent_status_enum ADD VALUE IF NOT EXISTS 'withdrawn';

-- ── SOP (service_indents): reference code + category + priority ────────
ALTER TABLE service_indents ADD COLUMN ref VARCHAR(40);
ALTER TABLE service_indents ADD COLUMN category VARCHAR(50);
ALTER TABLE service_indents ADD COLUMN priority VARCHAR(10); -- 'High' | 'Medium' | 'Low'
ALTER TYPE indent_status_enum ADD VALUE IF NOT EXISTS 'draft'; -- no-op if already added above (same enum)
ALTER TYPE indent_status_enum ADD VALUE IF NOT EXISTS 'withdrawn';

-- ── Media Request: guest details, poster deadline, audience ────────────
ALTER TABLE media_requests ADD COLUMN guest_name VARCHAR(150);
ALTER TABLE media_requests ADD COLUMN guest_designation VARCHAR(150);
ALTER TABLE media_requests ADD COLUMN poster_needed_by DATE;
ALTER TABLE media_requests ADD COLUMN audience TEXT[];

-- ── Venue Booking: reference code + real cancel/withdraw state ─────────
ALTER TABLE venue_bookings ADD COLUMN ref VARCHAR(40);
ALTER TYPE venue_booking_status_enum ADD VALUE IF NOT EXISTS 'cancelled';

-- ── Student Outpass: actual gate exit/return timestamps (distinct from
-- the planned from_time/to_time window) ─────────────────────────────────
ALTER TABLE student_outpasses ADD COLUMN actual_exit_at TIMESTAMPTZ;
ALTER TABLE student_outpasses ADD COLUMN actual_return_at TIMESTAMPTZ;
