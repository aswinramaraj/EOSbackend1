-- Adds Razorpay support to canteen_orders (previously wallet-only) - purely
-- additive, no other tables touched. Mirrors stationery_orders' own
-- razorpay_order_id/payment_id/signature + payment_status columns.
BEGIN;

ALTER TABLE canteen_orders
  ADD COLUMN IF NOT EXISTS payment_status VARCHAR(20) DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS razorpay_order_id VARCHAR(100),
  ADD COLUMN IF NOT EXISTS razorpay_payment_id VARCHAR(100),
  ADD COLUMN IF NOT EXISTS razorpay_signature VARCHAR(255);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_canteen_orders_razorpay_order_id'
  ) THEN
    ALTER TABLE canteen_orders
      ADD CONSTRAINT uq_canteen_orders_razorpay_order_id UNIQUE (razorpay_order_id);
  END IF;
END $$;

-- Backfill: every existing row was a synchronous wallet checkout (payment
-- already cleared before the row was ever inserted) - 'refunded' for a
-- cancelled order that actually had a wallet debit to reverse, 'paid' for
-- everything else already in the table.
UPDATE canteen_orders
SET payment_status = CASE
  WHEN status = 'cancelled' AND wallet_transaction_id IS NOT NULL THEN 'refunded'
  ELSE 'paid'
END
WHERE payment_status = 'pending';

COMMIT;
