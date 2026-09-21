-- Canteen self-ordering (student/staff) — additive schema changes only,
-- cross-verified against the live DB before applying. Nothing here alters
-- or drops any existing column/table.

-- Human-readable pickup code shown to the orderer and looked up by the
-- Cashier when the person arrives to collect — derived from the order's own
-- id once created (e.g. 'CV00123'), so no separate uniqueness check is
-- needed. Null for Cashier's own walk-in orders (order_source='cashier'),
-- which have no pickup step.
ALTER TABLE canteen_orders ADD COLUMN pickup_token VARCHAR(12);

-- Links a self-placed order to the wallet_transactions row that paid for
-- it — lets a refund-on-cancel reverse the exact right transaction, and
-- lets the order detail screen show payment status without re-deriving it.
ALTER TABLE canteen_orders ADD COLUMN wallet_transaction_id INTEGER REFERENCES wallet_transactions(id) ON DELETE SET NULL;

CREATE INDEX idx_canteen_orders_pickup_token ON canteen_orders(pickup_token);
