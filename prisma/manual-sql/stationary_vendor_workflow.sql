-- Stationary vendor-fulfillment workflow.
--
-- stationary_request_status_enum only had pending_payment/paid - nobody on
-- the vendor side could ever see or act on a paid request. Adds the
-- statuses a real print-shop vendor needs to move a request through after
-- payment, plus a reason column for the reject path.
--
-- ALTER TYPE ... ADD VALUE must run outside any surrounding transaction/
-- batched-with-other-DDL block (a new enum value can't be used in the same
-- transaction that added it on older Postgres) - each statement below is
-- its own autocommitted statement for that reason, same as running them
-- one at a time at a psql prompt.
ALTER TYPE stationary_request_status_enum ADD VALUE IF NOT EXISTS 'processing';
ALTER TYPE stationary_request_status_enum ADD VALUE IF NOT EXISTS 'ready_for_pickup';
ALTER TYPE stationary_request_status_enum ADD VALUE IF NOT EXISTS 'completed';
ALTER TYPE stationary_request_status_enum ADD VALUE IF NOT EXISTS 'rejected';

ALTER TABLE stationary_requests
  ADD COLUMN IF NOT EXISTS rejection_reason VARCHAR(300);
