-- Stationary/print-shop request module.
--
-- stationary_requests already existed (created 2026-09-04, 6 real rows, all
-- still 'pending_payment' - the verify step was apparently never actually
-- wired up before this). This migration only ADDS columns for the new
-- design (per-page pricing, paper size/sides, binding) - nothing existing
-- is touched, so the 6 pre-existing rows are unaffected and stay readable
-- with these new columns simply null.
--
-- No per-document page-count extraction exists anywhere in this app yet
-- (no PDF parser) - total_pages is a client-declared quantity, same trust
-- model as e.g. venue_bookings.accommodating_strength. The amount itself
-- is always server-computed from total_pages/copies (see
-- StationaryService.PRICE_PER_PAGE = 2), never trusted from the client.
-- (file_name, the table's pre-existing single-file-name column, is reused
-- as-is for the new design's short request summary - no new column needed
-- for that; the API's own field is still named file_summary, mapped onto
-- file_name only inside StationaryService.)
ALTER TABLE stationary_requests
  ADD COLUMN IF NOT EXISTS total_pages INTEGER,
  ADD COLUMN IF NOT EXISTS binding VARCHAR(20),
  ADD COLUMN IF NOT EXISTS paper_size VARCHAR(10),
  ADD COLUMN IF NOT EXISTS sides VARCHAR(20);

-- binding stores the same human-readable label the mobile UI shows (no
-- separate display-label mapping layer needed anywhere in the stack).
ALTER TABLE stationary_requests DROP CONSTRAINT IF EXISTS stationary_requests_binding_check;
ALTER TABLE stationary_requests ADD CONSTRAINT stationary_requests_binding_check
  CHECK (binding IN ('No binding', 'Spiral binding', 'Calico binding'));
