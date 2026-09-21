-- Daily-reset random 3-digit order token for the Canteen kitchen/counter
-- display feature — see canteen_queue_display.query.md for the full
-- rationale. Additive only; CanteenOrderingService.placeOrder() already
-- has a legacy-token fallback for before this column exists.
ALTER TABLE "canteen_orders" ADD COLUMN "token_date" DATE;

CREATE INDEX "idx_canteen_orders_self_active" ON "canteen_orders"("order_source", "status", "created_at");

CREATE UNIQUE INDEX "uq_canteen_orders_token_per_day" ON "canteen_orders"("token_date", "pickup_token") WHERE (order_source = 'self' AND status <> 'cancelled');
