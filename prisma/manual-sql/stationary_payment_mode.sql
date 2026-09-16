-- Reports page's "Collection by mode" panel (UPI / Internal voucher / Cash)
-- - user-approved before creation. Online orders (createOrder) always set
-- 'online' at creation; a counter/walk-in entry (createCounterEntry) needs
-- the vendor to pick a real mode. Existing rows are left NULL (created
-- before this column existed) rather than backfilled with a guessed mode.
ALTER TABLE stationary_requests
  ADD COLUMN IF NOT EXISTS payment_mode VARCHAR(30);
