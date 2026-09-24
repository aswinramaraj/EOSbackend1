-- Canteen Cashier — additive schema changes only, cross-verified against the
-- live DB before applying (see conversation for the verification queries).
-- Nothing here alters or drops any existing column/table.

-- Per cart line: was this item marked for takeaway/parcel? Drives the flat
-- parcel charge (configurable in canteen_settings) added to the bill total.
ALTER TABLE canteen_order_items ADD COLUMN is_parcel BOOLEAN NOT NULL DEFAULT false;

-- Set when a cashier explicitly overrides an insufficient-stock block to
-- complete a sale anyway (dish quantity goes negative). Surfaced in Reports
-- so Admin can see which sales bypassed the normal stock check.
ALTER TABLE canteen_orders ADD COLUMN is_emergency BOOLEAN NOT NULL DEFAULT false;

-- Reuses the existing transaction_status boolean as the void flag
-- (true = active, false = voided) — no new column needed there beyond a
-- timestamp for when the void happened.
ALTER TABLE canteen_bills ADD COLUMN voided_at TIMESTAMPTZ;

-- Single-row canteen-wide billing policy: GST % and flat parcel charge,
-- both editable only by Canteen Admin. Application code always reads/writes
-- the single lowest-id row; enforced by convention, not a DB constraint,
-- matching this schema's existing lookup-table style.
CREATE TABLE canteen_settings (
  id             SERIAL PRIMARY KEY,
  gst_percentage DECIMAL(5,2) NOT NULL DEFAULT 0,
  parcel_charge  DECIMAL(10,2) NOT NULL DEFAULT 5,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO canteen_settings (gst_percentage, parcel_charge) VALUES (0, 5);
