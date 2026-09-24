-- ===========================================================================
-- stationery_store.sql
-- ===========================================================================
-- Storage for the new campus "Stationery Store" (notebooks/snacks/personal
-- care/hostel essentials/college merch, with a shopping cart, wallet or
-- Razorpay payment, and a pickup token) - see the reference design at
-- "College ERP stationery login/Stationery Login.dc.html". Deliberately
-- separate from the pre-existing `stationary_requests`/`stationary_*` tables,
-- which are the Xerox/print-shop copy-job flow (StationaryScreen.tsx) - a
-- different feature entirely, just an unlucky name collision.
--
-- SAFETY / SCOPE GUARANTEES
--   * PURELY ADDITIVE. Only CREATEs new types/tables/indexes. No ALTER, DROP
--     or UPDATE against any pre-existing table.
--   * Idempotent - every object is guarded, so a partial run can be re-run.
--   * Wrapped in one transaction - any error rolls the whole thing back.
--   * Wallet debits for a "pay with wallet" order reuse the EXISTING
--     wallet_transactions table (source='purchase', already a valid
--     wallet_txn_source_enum value) and the EXISTING wallet_outlets row
--     (id=11, "Campus Stationery Store", outlet_type='stationary') - both
--     already present in this database, seeded ahead of this feature. No
--     wallet-schema change of any kind.
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. ENUM TYPES (all new; no existing type is modified)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'stationery_category_enum') THEN
    CREATE TYPE "stationery_category_enum" AS ENUM ('study', 'food', 'care', 'hostel', 'college');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'stationery_order_status_enum') THEN
    CREATE TYPE "stationery_order_status_enum" AS ENUM (
      'pending',           -- Razorpay order staged, payment not yet verified
      'confirmed',         -- paid (wallet, instant, or Razorpay, verified) - queued for the counter
      'preparing',         -- counter staff has started packing it
      'ready_for_pickup',
      'collected',
      'cancelled'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'stationery_payment_method_enum') THEN
    CREATE TYPE "stationery_payment_method_enum" AS ENUM ('wallet', 'razorpay');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'stationery_payment_status_enum') THEN
    CREATE TYPE "stationery_payment_status_enum" AS ENUM ('pending', 'paid', 'failed', 'refunded');
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. stationery_products - the admin-managed catalogue. Web admin UI is a
--    separate, later deliverable; this table is what it will read/write.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "stationery_products" (
    "id"                 SERIAL                      NOT NULL,
    "category"           "stationery_category_enum"  NOT NULL,
    "name"               VARCHAR(150)                NOT NULL,
    "description"        VARCHAR(500),
    -- Short bullet specs shown on the product card (e.g. "200 pages",
    -- "A5 size") - display-only, never parsed.
    "specs"              TEXT[]                      NOT NULL DEFAULT '{}',
    "price"              NUMERIC(10,2)                NOT NULL,
    -- Struck-through "was" price for a discount badge - NULL means no
    -- discount shown. Must be strictly above `price` when present, enforced
    -- below rather than left to application code to remember.
    "original_price"     NUMERIC(10,2),
    "stock_quantity"     INTEGER                      NOT NULL DEFAULT 0,
    "image_url"          VARCHAR(500),
    -- Soft-hide instead of delete - preserves history on past orders that
    -- reference this row (order items snapshot name/price anyway, but the
    -- FK itself should never go dangling).
    "is_active"          BOOLEAN                      NOT NULL DEFAULT TRUE,
    "created_by_user_id" INTEGER,
    "created_at"         TIMESTAMPTZ(6)               NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"         TIMESTAMPTZ(6)               NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stationery_products_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "stationery_products_price_check" CHECK ("price" >= 0),
    CONSTRAINT "stationery_products_original_price_check" CHECK ("original_price" IS NULL OR "original_price" > "price"),
    CONSTRAINT "stationery_products_stock_check" CHECK ("stock_quantity" >= 0)
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stationery_products_created_by_user_id_fkey') THEN
    ALTER TABLE "stationery_products" ADD CONSTRAINT "stationery_products_created_by_user_id_fkey"
      FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "idx_stationery_products_category" ON "stationery_products" ("category") WHERE "is_active" = TRUE;

-- ---------------------------------------------------------------------------
-- 3. stationery_orders - one row per checkout. A 'pending' row (Razorpay
--    only) exists before payment is verified; stock is only ever decremented
--    once a row reaches 'confirmed' (see StationeryService.verifyRazorpayOrder/
--    checkoutWithWallet, which do both inside one DB transaction).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "stationery_orders" (
    "id"                    SERIAL                             NOT NULL,
    "user_id"               INTEGER                            NOT NULL,
    "status"                "stationery_order_status_enum"     NOT NULL DEFAULT 'pending',
    "subtotal"              NUMERIC(10,2)                      NOT NULL,
    "gst_amount"            NUMERIC(10,2)                      NOT NULL,
    "total_amount"          NUMERIC(10,2)                      NOT NULL,
    "payment_method"        "stationery_payment_method_enum"   NOT NULL,
    "payment_status"        "stationery_payment_status_enum"   NOT NULL DEFAULT 'pending',
    -- Shown at the counter to collect the order - assigned once payment_status
    -- becomes 'paid', NULL before that.
    "pickup_token"          VARCHAR(20)                        UNIQUE,
    "razorpay_order_id"     VARCHAR(100)                       UNIQUE,
    "razorpay_payment_id"   VARCHAR(100),
    "razorpay_signature"    VARCHAR(255),
    -- Set for a wallet-paid order - the debit's own wallet_transactions row,
    -- for a clean audit trail from either direction.
    "wallet_transaction_id" INTEGER,
    "cancel_reason"         VARCHAR(255),
    "created_at"            TIMESTAMPTZ(6)                     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmed_at"          TIMESTAMPTZ(6),
    "ready_at"              TIMESTAMPTZ(6),
    "collected_at"          TIMESTAMPTZ(6),
    "cancelled_at"          TIMESTAMPTZ(6),

    CONSTRAINT "stationery_orders_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "stationery_orders_subtotal_check" CHECK ("subtotal" >= 0),
    CONSTRAINT "stationery_orders_gst_amount_check" CHECK ("gst_amount" >= 0),
    CONSTRAINT "stationery_orders_total_amount_check" CHECK ("total_amount" >= 0)
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stationery_orders_user_id_fkey') THEN
    ALTER TABLE "stationery_orders" ADD CONSTRAINT "stationery_orders_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stationery_orders_wallet_transaction_id_fkey') THEN
    ALTER TABLE "stationery_orders" ADD CONSTRAINT "stationery_orders_wallet_transaction_id_fkey"
      FOREIGN KEY ("wallet_transaction_id") REFERENCES "wallet_transactions"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "idx_stationery_orders_user" ON "stationery_orders" ("user_id", "created_at");
CREATE INDEX IF NOT EXISTS "idx_stationery_orders_status" ON "stationery_orders" ("status");

-- ---------------------------------------------------------------------------
-- 4. stationery_order_items - name/price are a snapshot at purchase time
--    (never re-read from stationery_products for an existing order), so a
--    later price/name change on the product never rewrites order history.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "stationery_order_items" (
    "id"           SERIAL          NOT NULL,
    "order_id"     INTEGER         NOT NULL,
    "product_id"   INTEGER         NOT NULL,
    "product_name" VARCHAR(150)    NOT NULL,
    "unit_price"   NUMERIC(10,2)   NOT NULL,
    "quantity"     INTEGER         NOT NULL,
    "subtotal"     NUMERIC(10,2)   NOT NULL,

    CONSTRAINT "stationery_order_items_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "stationery_order_items_quantity_check" CHECK ("quantity" > 0),
    CONSTRAINT "stationery_order_items_unit_price_check" CHECK ("unit_price" >= 0)
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stationery_order_items_order_id_fkey') THEN
    ALTER TABLE "stationery_order_items" ADD CONSTRAINT "stationery_order_items_order_id_fkey"
      FOREIGN KEY ("order_id") REFERENCES "stationery_orders"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stationery_order_items_product_id_fkey') THEN
    ALTER TABLE "stationery_order_items" ADD CONSTRAINT "stationery_order_items_product_id_fkey"
      FOREIGN KEY ("product_id") REFERENCES "stationery_products"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "idx_stationery_order_items_order" ON "stationery_order_items" ("order_id");

COMMIT;
