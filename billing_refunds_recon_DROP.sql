-- ============================================================================
-- Billing module: DROP the Refunds + Bank Reconciliation tables
-- Run this once against the real dev database (same way you ran the
-- creation migration). This fully removes the two tables and the enum
-- that were added for the (now-removed) Refunds/Reconciliation feature.
--
-- After running this, run the same two commands you ran last time so
-- Prisma stops expecting these tables to exist:
--   npx prisma db pull
--   npx prisma generate
-- ============================================================================

DROP TABLE IF EXISTS refunds;
DROP TABLE IF EXISTS bank_reconciliation_entries;
DROP TYPE IF EXISTS refund_status_enum;

-- Done. All backend/frontend code referencing these was already removed
-- this session — no application code depends on these tables any more.
