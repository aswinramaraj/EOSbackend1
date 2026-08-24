-- ===========================================================================
-- finance_module_reapproval_fix.sql
-- ===========================================================================
-- Fixes one real defect in finance_module.sql.
--
-- THE PROBLEM
--   The original script created these two partial unique indexes:
--       uq_finance_ledger_one_debit_per_pop
--       uq_finance_ledger_one_debit_per_sop
--   They guarantee a proposal can be debited at most once, which correctly
--   stops double-spending. But the ledger is append-only, so releasing a
--   commitment adds a compensating `order_cancellation` reversal rather than
--   deleting the debit — the original debit row stays forever. The index
--   therefore also blocks the *legitimate* case: a proposal whose commitment
--   was released can never be approved again, permanently. Attempting it
--   fails with FINANCE_ALREADY_DEBITED even though the fund owes nothing.
--
-- THE FIX
--   Drop those two indexes and rely on the proposal's own state machine,
--   which the application now enforces atomically: the approval performs
--       UPDATE ... WHERE id = ? AND status = 'pending'
--   inside the same transaction as the debit. That takes a row lock, so two
--   simultaneous approvals serialise and the loser matches zero rows and is
--   rejected. Double-spending stays impossible, and a released proposal
--   becomes approvable again.
--
--   Everything else is untouched. In particular these protections remain:
--     * the append-only triggers on the ledger, audit log and event tables
--     * the no-overdraft rule (a debit below zero is refused)
--     * available_amount being writable only by the ledger trigger
--     * uq_finance_ledger_one_reversal_per_pop / _per_sop — a commitment can
--       still only be released once, which is the half that genuinely must
--       stay unique
--
-- Safe to run twice, and wrapped in a transaction.
-- ===========================================================================

BEGIN;

DROP INDEX IF EXISTS "uq_finance_ledger_one_debit_per_pop";
DROP INDEX IF EXISTS "uq_finance_ledger_one_debit_per_sop";

-- Kept for lookup speed: the same columns are still queried constantly when
-- reporting what is committed per proposal, they simply must not be unique.
CREATE INDEX IF NOT EXISTS "idx_finance_ledger_pop"
  ON "finance_ledger_entries" ("purchase_order_proposal_id")
  WHERE "purchase_order_proposal_id" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "idx_finance_ledger_sop"
  ON "finance_ledger_entries" ("service_order_proposal_id")
  WHERE "service_order_proposal_id" IS NOT NULL;

COMMIT;

-- ===========================================================================
-- VERIFY (read-only)
-- ===========================================================================
-- Should return no rows once this has run:
--   SELECT indexname FROM pg_indexes
--    WHERE indexname IN ('uq_finance_ledger_one_debit_per_pop',
--                        'uq_finance_ledger_one_debit_per_sop');
--
-- Should still list both reversal guards:
--   SELECT indexname FROM pg_indexes
--    WHERE indexname LIKE 'uq_finance_ledger_one_reversal%';
-- ===========================================================================
