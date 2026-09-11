-- ===========================================================================
-- finance_proposal_assignments.sql
-- ===========================================================================
-- Adds the "who is this for?" step to POP/SOP approval.
--
-- WHY A SEPARATE TABLE
--   `finance_order_allotments` records actual custody and is deliberately
--   gated: the database refuses an allotment until the order is delivered,
--   because you cannot hand over something that has not arrived. But Finance
--   wants to nominate the receiving faculty member at approval time, long
--   before delivery. Those are two different facts:
--
--     assignment  = intent, recorded at approval        (this table)
--     allotment    = custody, recorded on delivery       (existing table)
--
--   Keeping them apart means the intent can be captured early without
--   weakening the custody rule, and the tracking screen can pre-fill the
--   allotment from the assignment when the goods actually land.
--
-- SAFETY
--   Purely additive: one new table, no change to any existing table, no
--   change to `roles`. Idempotent and transactional.
-- ===========================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS "finance_proposal_assignments" (
    "id"                          SERIAL           NOT NULL,
    -- Exactly one of these, mirroring how the ledger references a proposal.
    "purchase_order_proposal_id"  INTEGER,
    "service_order_proposal_id"   INTEGER,
    "faculty_id"                  INTEGER          NOT NULL,
    "note"                        VARCHAR(500),
    "assigned_by_user_id"         INTEGER          NOT NULL,
    "assigned_at"                 TIMESTAMPTZ(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at"                  TIMESTAMPTZ(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"                  TIMESTAMPTZ(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "finance_proposal_assignments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "finance_proposal_assignments_one_ref_check" CHECK (
      ("purchase_order_proposal_id" IS NOT NULL) <> ("service_order_proposal_id" IS NOT NULL)
    )
);

-- One nominated faculty member per proposal: re-assigning replaces, never
-- accumulates, so there is no ambiguity about who the order is for.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_finance_assignment_per_pop"
  ON "finance_proposal_assignments" ("purchase_order_proposal_id")
  WHERE "purchase_order_proposal_id" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "uq_finance_assignment_per_sop"
  ON "finance_proposal_assignments" ("service_order_proposal_id")
  WHERE "service_order_proposal_id" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "idx_finance_assignment_faculty"
  ON "finance_proposal_assignments" ("faculty_id");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'finance_proposal_assignments_pop_fkey') THEN
    ALTER TABLE "finance_proposal_assignments" ADD CONSTRAINT "finance_proposal_assignments_pop_fkey"
      FOREIGN KEY ("purchase_order_proposal_id") REFERENCES "purchase_order_proposals"("id")
      ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'finance_proposal_assignments_sop_fkey') THEN
    ALTER TABLE "finance_proposal_assignments" ADD CONSTRAINT "finance_proposal_assignments_sop_fkey"
      FOREIGN KEY ("service_order_proposal_id") REFERENCES "service_order_proposals"("id")
      ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'finance_proposal_assignments_faculty_fkey') THEN
    ALTER TABLE "finance_proposal_assignments" ADD CONSTRAINT "finance_proposal_assignments_faculty_fkey"
      FOREIGN KEY ("faculty_id") REFERENCES "faculty"("id")
      ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'finance_proposal_assignments_assigned_by_fkey') THEN
    ALTER TABLE "finance_proposal_assignments" ADD CONSTRAINT "finance_proposal_assignments_assigned_by_fkey"
      FOREIGN KEY ("assigned_by_user_id") REFERENCES "users"("id")
      ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

-- Same lockdown as the other finance tables: RLS on with no policies blocks
-- Supabase's auto-generated REST API; the backend connects as the owner and
-- bypasses RLS, so the application is unaffected.
ALTER TABLE "finance_proposal_assignments" ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE r TEXT;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE %I FROM %I', 'finance_proposal_assignments', r);
    END IF;
  END LOOP;
END $$;

COMMIT;
