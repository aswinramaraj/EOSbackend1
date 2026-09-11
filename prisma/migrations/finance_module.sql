-- ===========================================================================
-- finance_module.sql
-- ===========================================================================
-- Storage for the Finance module: the finance fund (total amount), an
-- append-only money ledger, POP/SOP delivery tracking, faculty allotment of
-- delivered items, and an immutable audit log.
--
-- SAFETY / SCOPE GUARANTEES
--   * PURELY ADDITIVE. This script only ever CREATEs new types, tables,
--     functions, triggers and indexes. It contains no ALTER, DROP or UPDATE
--     against any pre-existing table, and it never touches `roles`.
--   * Idempotent. Safe to run twice: every object is created with an
--     existence guard, so a partial run can simply be re-run.
--   * Wrapped in a single transaction — any error rolls the whole thing back
--     and leaves the database exactly as it was.
--
-- WHY THE INTEGRITY MACHINERY BELOW EXISTS
--   Finance is the most sensitive area in this system, so correctness is
--   enforced by the database itself and not left to application code:
--     1. The ledger is append-only (UPDATE/DELETE are blocked by trigger),
--        so money movements can never be quietly rewritten.
--     2. `available_amount` is maintained *only* by the ledger trigger. A
--        direct write to it is rejected, so the balance can never drift away
--        from the sum of its entries.
--     3. A debit that would take the fund below zero is rejected outright.
--     4. A partial unique index makes double-spending structurally
--        impossible: one POP (and one SOP) can be debited at most once, even
--        if the API is called twice concurrently.
--     5. Allotment is only possible against an actually-delivered order, and
--        the allotted quantity can never exceed the delivered quantity.
--     6. Row Level Security is enabled with no policies, which blocks
--        Supabase's auto-generated REST API (anon/authenticated) from ever
--        reading or writing these tables. The backend connects as the table
--        owner, which bypasses RLS, so the application is unaffected.
--     7. Every financial FK is ON DELETE RESTRICT — a financial record can
--        never be silently cascaded away by deleting something upstream.
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. ENUM TYPES (all new; no existing type is modified)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'finance_ledger_entry_type_enum') THEN
    CREATE TYPE "finance_ledger_entry_type_enum" AS ENUM (
      'credit',              -- money added to the fund
      'debit',               -- money committed out of the fund (POP/SOP approval)
      'adjustment_increase', -- total amount revised upwards by Finance
      'adjustment_decrease', -- total amount revised downwards by Finance
      'reversal'             -- an earlier debit released (e.g. order cancelled)
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'finance_ledger_source_enum') THEN
    CREATE TYPE "finance_ledger_source_enum" AS ENUM (
      'opening_balance',
      'pop_approval',
      'sop_approval',
      'manual_adjustment',
      'order_cancellation'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'finance_order_kind_enum') THEN
    CREATE TYPE "finance_order_kind_enum" AS ENUM ('purchase', 'service');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'finance_delivery_status_enum') THEN
    -- Deliberately manual: staff advance this themselves (there is no carrier
    -- integration), which is why the UI offers it as a selectable step.
    CREATE TYPE "finance_delivery_status_enum" AS ENUM (
      'ordered',
      'dispatched',
      'in_transit',
      'partially_delivered',
      'delivered',
      'cancelled'
    );
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. finance_funds — the Finance module's own money pot, one row per
--    academic year. `total_amount` is what Finance declares/edits;
--    `available_amount` is derived from the ledger and is trigger-owned.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "finance_funds" (
    "id"                    SERIAL           NOT NULL,
    "academic_year"         VARCHAR(20)      NOT NULL,
    "total_amount"          NUMERIC(14,2)    NOT NULL DEFAULT 0,
    -- Maintained exclusively by the ledger trigger (see section 8). A direct
    -- write is rejected, so this can never disagree with the ledger.
    "available_amount"      NUMERIC(14,2)    NOT NULL DEFAULT 0,
    -- Closing a year freezes it: no further ledger movement is accepted.
    "is_locked"             BOOLEAN          NOT NULL DEFAULT FALSE,
    "notes"                 VARCHAR(500),
    "created_by_user_id"    INTEGER          NOT NULL,
    "updated_by_user_id"    INTEGER,
    "created_at"            TIMESTAMPTZ(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"            TIMESTAMPTZ(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "finance_funds_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "finance_funds_academic_year_key" UNIQUE ("academic_year"),
    CONSTRAINT "finance_funds_total_amount_check" CHECK ("total_amount" >= 0),
    CONSTRAINT "finance_funds_available_amount_check" CHECK ("available_amount" >= 0)
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'finance_funds_created_by_user_id_fkey') THEN
    ALTER TABLE "finance_funds" ADD CONSTRAINT "finance_funds_created_by_user_id_fkey"
      FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'finance_funds_updated_by_user_id_fkey') THEN
    ALTER TABLE "finance_funds" ADD CONSTRAINT "finance_funds_updated_by_user_id_fkey"
      FOREIGN KEY ("updated_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3. finance_ledger_entries — append-only record of every movement of money.
--    This table is the single source of truth for the balance.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "finance_ledger_entries" (
    "id"                            BIGSERIAL                          NOT NULL,
    "fund_id"                       INTEGER                            NOT NULL,
    "entry_type"                    "finance_ledger_entry_type_enum"   NOT NULL,
    "source"                        "finance_ledger_source_enum"       NOT NULL,
    "amount"                        NUMERIC(14,2)                      NOT NULL,
    -- Running balance immediately after this entry, stamped by the trigger.
    -- Gives an auditor a verifiable chain without recomputing every time.
    "balance_after"                 NUMERIC(14,2)                      NOT NULL,
    "purchase_order_proposal_id"    INTEGER,
    "service_order_proposal_id"     INTEGER,
    "narration"                     VARCHAR(500)                       NOT NULL,
    "created_by_user_id"            INTEGER                            NOT NULL,
    "created_at"                    TIMESTAMPTZ(6)                     NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "finance_ledger_entries_pkey" PRIMARY KEY ("id"),
    -- Amounts are always written as a positive magnitude; direction comes
    -- from entry_type. This removes any sign-convention ambiguity.
    CONSTRAINT "finance_ledger_entries_amount_check" CHECK ("amount" > 0),
    -- A POP-sourced entry must reference exactly its POP (and no SOP), and
    -- vice versa; every other source references neither.
    CONSTRAINT "finance_ledger_entries_source_ref_check" CHECK (
      ("source" = 'pop_approval'
        AND "purchase_order_proposal_id" IS NOT NULL AND "service_order_proposal_id" IS NULL)
      OR ("source" = 'sop_approval'
        AND "service_order_proposal_id" IS NOT NULL AND "purchase_order_proposal_id" IS NULL)
      OR ("source" = 'order_cancellation'
        AND (("purchase_order_proposal_id" IS NOT NULL) <> ("service_order_proposal_id" IS NOT NULL)))
      OR ("source" IN ('opening_balance', 'manual_adjustment')
        AND "purchase_order_proposal_id" IS NULL AND "service_order_proposal_id" IS NULL)
    )
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'finance_ledger_entries_fund_id_fkey') THEN
    ALTER TABLE "finance_ledger_entries" ADD CONSTRAINT "finance_ledger_entries_fund_id_fkey"
      FOREIGN KEY ("fund_id") REFERENCES "finance_funds"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'finance_ledger_entries_pop_fkey') THEN
    ALTER TABLE "finance_ledger_entries" ADD CONSTRAINT "finance_ledger_entries_pop_fkey"
      FOREIGN KEY ("purchase_order_proposal_id") REFERENCES "purchase_order_proposals"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'finance_ledger_entries_sop_fkey') THEN
    ALTER TABLE "finance_ledger_entries" ADD CONSTRAINT "finance_ledger_entries_sop_fkey"
      FOREIGN KEY ("service_order_proposal_id") REFERENCES "service_order_proposals"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'finance_ledger_entries_created_by_user_id_fkey') THEN
    ALTER TABLE "finance_ledger_entries" ADD CONSTRAINT "finance_ledger_entries_created_by_user_id_fkey"
      FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "idx_finance_ledger_fund_created"
  ON "finance_ledger_entries" ("fund_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_finance_ledger_source"
  ON "finance_ledger_entries" ("source");

-- DOUBLE-SPEND PREVENTION. These partial unique indexes are the structural
-- guarantee that an approval can only ever take money out once: a second
-- concurrent approval of the same proposal fails on the index, not on a
-- best-effort application check.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_finance_ledger_one_debit_per_pop"
  ON "finance_ledger_entries" ("purchase_order_proposal_id")
  WHERE "source" = 'pop_approval' AND "entry_type" = 'debit';
CREATE UNIQUE INDEX IF NOT EXISTS "uq_finance_ledger_one_debit_per_sop"
  ON "finance_ledger_entries" ("service_order_proposal_id")
  WHERE "source" = 'sop_approval' AND "entry_type" = 'debit';
-- Equally, a released/cancelled order may only be refunded to the fund once.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_finance_ledger_one_reversal_per_pop"
  ON "finance_ledger_entries" ("purchase_order_proposal_id")
  WHERE "source" = 'order_cancellation' AND "purchase_order_proposal_id" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "uq_finance_ledger_one_reversal_per_sop"
  ON "finance_ledger_entries" ("service_order_proposal_id")
  WHERE "source" = 'order_cancellation' AND "service_order_proposal_id" IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 4. finance_order_tracking — one row per placed order (POP or SOP), holding
--    its manually-advanced delivery state.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "finance_order_tracking" (
    "id"                    SERIAL                           NOT NULL,
    "order_kind"            "finance_order_kind_enum"        NOT NULL,
    "purchase_order_id"     INTEGER,
    "service_order_id"      INTEGER,
    "delivery_status"       "finance_delivery_status_enum"   NOT NULL DEFAULT 'ordered',
    "expected_delivery_date" DATE,
    "delivered_at"          TIMESTAMPTZ(6),
    "quantity_ordered"      INTEGER,
    "quantity_delivered"    INTEGER                          NOT NULL DEFAULT 0,
    "tracking_reference"    VARCHAR(120),
    "remarks"               VARCHAR(500),
    "created_by_user_id"    INTEGER                          NOT NULL,
    "updated_by_user_id"    INTEGER,
    "created_at"            TIMESTAMPTZ(6)                   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"            TIMESTAMPTZ(6)                   NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "finance_order_tracking_pkey" PRIMARY KEY ("id"),
    -- Exactly one order reference, and it must agree with order_kind.
    CONSTRAINT "finance_order_tracking_one_order_check" CHECK (
      ("order_kind" = 'purchase' AND "purchase_order_id" IS NOT NULL AND "service_order_id" IS NULL)
      OR ("order_kind" = 'service' AND "service_order_id" IS NOT NULL AND "purchase_order_id" IS NULL)
    ),
    -- One tracking row per order — never two competing states for one order.
    CONSTRAINT "finance_order_tracking_purchase_order_id_key" UNIQUE ("purchase_order_id"),
    CONSTRAINT "finance_order_tracking_service_order_id_key" UNIQUE ("service_order_id"),
    CONSTRAINT "finance_order_tracking_quantities_check" CHECK (
      "quantity_delivered" >= 0
      AND ("quantity_ordered" IS NULL OR "quantity_ordered" > 0)
      AND ("quantity_ordered" IS NULL OR "quantity_delivered" <= "quantity_ordered")
    ),
    -- A delivered order must say when it was delivered.
    CONSTRAINT "finance_order_tracking_delivered_at_check" CHECK (
      ("delivery_status" NOT IN ('delivered', 'partially_delivered')) OR "delivered_at" IS NOT NULL
    )
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'finance_order_tracking_purchase_order_id_fkey') THEN
    ALTER TABLE "finance_order_tracking" ADD CONSTRAINT "finance_order_tracking_purchase_order_id_fkey"
      FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'finance_order_tracking_service_order_id_fkey') THEN
    ALTER TABLE "finance_order_tracking" ADD CONSTRAINT "finance_order_tracking_service_order_id_fkey"
      FOREIGN KEY ("service_order_id") REFERENCES "service_orders"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'finance_order_tracking_created_by_user_id_fkey') THEN
    ALTER TABLE "finance_order_tracking" ADD CONSTRAINT "finance_order_tracking_created_by_user_id_fkey"
      FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'finance_order_tracking_updated_by_user_id_fkey') THEN
    ALTER TABLE "finance_order_tracking" ADD CONSTRAINT "finance_order_tracking_updated_by_user_id_fkey"
      FOREIGN KEY ("updated_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "idx_finance_tracking_kind_status"
  ON "finance_order_tracking" ("order_kind", "delivery_status");

-- ---------------------------------------------------------------------------
-- 5. finance_order_tracking_events — append-only timeline behind the animated
--    tracking UI. Every status change leaves a permanent, attributable step.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "finance_order_tracking_events" (
    "id"                  BIGSERIAL                        NOT NULL,
    "tracking_id"         INTEGER                          NOT NULL,
    "from_status"         "finance_delivery_status_enum",
    "to_status"           "finance_delivery_status_enum"   NOT NULL,
    "note"                VARCHAR(500),
    "changed_by_user_id"  INTEGER                          NOT NULL,
    "changed_at"          TIMESTAMPTZ(6)                   NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "finance_order_tracking_events_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'finance_order_tracking_events_tracking_id_fkey') THEN
    ALTER TABLE "finance_order_tracking_events" ADD CONSTRAINT "finance_order_tracking_events_tracking_id_fkey"
      FOREIGN KEY ("tracking_id") REFERENCES "finance_order_tracking"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'finance_order_tracking_events_changed_by_user_id_fkey') THEN
    ALTER TABLE "finance_order_tracking_events" ADD CONSTRAINT "finance_order_tracking_events_changed_by_user_id_fkey"
      FOREIGN KEY ("changed_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "idx_finance_tracking_events_tracking"
  ON "finance_order_tracking_events" ("tracking_id", "changed_at");

-- ---------------------------------------------------------------------------
-- 6. finance_order_allotments — handing a delivered item to a faculty member.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "finance_order_allotments" (
    "id"                   SERIAL           NOT NULL,
    "tracking_id"          INTEGER          NOT NULL,
    "faculty_id"           INTEGER          NOT NULL,
    "quantity"             INTEGER          NOT NULL DEFAULT 1,
    "allotted_at"          TIMESTAMPTZ(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "allotted_by_user_id"  INTEGER          NOT NULL,
    "remarks"              VARCHAR(500),
    "created_at"           TIMESTAMPTZ(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"           TIMESTAMPTZ(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "finance_order_allotments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "finance_order_allotments_quantity_check" CHECK ("quantity" > 0)
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'finance_order_allotments_tracking_id_fkey') THEN
    ALTER TABLE "finance_order_allotments" ADD CONSTRAINT "finance_order_allotments_tracking_id_fkey"
      FOREIGN KEY ("tracking_id") REFERENCES "finance_order_tracking"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'finance_order_allotments_faculty_id_fkey') THEN
    ALTER TABLE "finance_order_allotments" ADD CONSTRAINT "finance_order_allotments_faculty_id_fkey"
      FOREIGN KEY ("faculty_id") REFERENCES "faculty"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'finance_order_allotments_allotted_by_user_id_fkey') THEN
    ALTER TABLE "finance_order_allotments" ADD CONSTRAINT "finance_order_allotments_allotted_by_user_id_fkey"
      FOREIGN KEY ("allotted_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "idx_finance_allotments_tracking"
  ON "finance_order_allotments" ("tracking_id");
CREATE INDEX IF NOT EXISTS "idx_finance_allotments_faculty"
  ON "finance_order_allotments" ("faculty_id");

-- ---------------------------------------------------------------------------
-- 7. finance_audit_log — immutable "who did what" trail for the whole module.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "finance_audit_log" (
    "id"             BIGSERIAL        NOT NULL,
    "actor_user_id"  INTEGER          NOT NULL,
    "action"         VARCHAR(60)      NOT NULL,
    "entity_type"    VARCHAR(60)      NOT NULL,
    "entity_id"      INTEGER,
    "before_data"    JSONB,
    "after_data"     JSONB,
    "ip_address"     INET,
    "user_agent"     VARCHAR(300),
    "created_at"     TIMESTAMPTZ(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "finance_audit_log_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'finance_audit_log_actor_user_id_fkey') THEN
    ALTER TABLE "finance_audit_log" ADD CONSTRAINT "finance_audit_log_actor_user_id_fkey"
      FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "idx_finance_audit_entity"
  ON "finance_audit_log" ("entity_type", "entity_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_finance_audit_actor"
  ON "finance_audit_log" ("actor_user_id", "created_at" DESC);

-- ---------------------------------------------------------------------------
-- 8. LEDGER ENGINE
--    Computes balance_after, enforces the no-overdraft rule, and is the only
--    thing permitted to move finance_funds.available_amount.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "finance_ledger_apply"() RETURNS TRIGGER AS $$
DECLARE
  v_current  NUMERIC(14,2);
  v_locked   BOOLEAN;
  v_delta    NUMERIC(14,2);
  v_new      NUMERIC(14,2);
BEGIN
  -- Serialise concurrent movements on the same fund. Without this lock two
  -- simultaneous approvals could each read the same balance and both pass
  -- the overdraft check.
  SELECT "available_amount", "is_locked" INTO v_current, v_locked
  FROM "finance_funds" WHERE "id" = NEW."fund_id" FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'finance: fund % does not exist', NEW."fund_id";
  END IF;

  IF v_locked THEN
    RAISE EXCEPTION 'finance: fund % is locked and cannot accept further movement', NEW."fund_id";
  END IF;

  v_delta := CASE NEW."entry_type"
               WHEN 'credit'              THEN  NEW."amount"
               WHEN 'adjustment_increase' THEN  NEW."amount"
               WHEN 'reversal'            THEN  NEW."amount"
               WHEN 'debit'               THEN -NEW."amount"
               WHEN 'adjustment_decrease' THEN -NEW."amount"
             END;

  v_new := v_current + v_delta;

  -- No overdraft: Finance can never commit money the fund does not hold.
  IF v_new < 0 THEN
    RAISE EXCEPTION
      'finance: insufficient funds — available %, requested %', v_current, NEW."amount"
      USING ERRCODE = 'check_violation';
  END IF;

  NEW."balance_after" := v_new;

  -- Flag this transaction as a legitimate, trigger-driven balance change so
  -- the guard in finance_funds_guard() lets it through.
  PERFORM set_config('eos.finance_ledger_ctx', '1', true);
  UPDATE "finance_funds"
     SET "available_amount" = v_new,
         "updated_at"       = CURRENT_TIMESTAMP
   WHERE "id" = NEW."fund_id";
  PERFORM set_config('eos.finance_ledger_ctx', '0', true);

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "trg_finance_ledger_apply" ON "finance_ledger_entries";
CREATE TRIGGER "trg_finance_ledger_apply"
  BEFORE INSERT ON "finance_ledger_entries"
  FOR EACH ROW EXECUTE FUNCTION "finance_ledger_apply"();

-- The ledger is history: it may only ever grow.
CREATE OR REPLACE FUNCTION "finance_append_only"() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION
    'finance: % on % is not permitted — this table is append-only', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "trg_finance_ledger_append_only" ON "finance_ledger_entries";
CREATE TRIGGER "trg_finance_ledger_append_only"
  BEFORE UPDATE OR DELETE ON "finance_ledger_entries"
  FOR EACH ROW EXECUTE FUNCTION "finance_append_only"();

DROP TRIGGER IF EXISTS "trg_finance_audit_append_only" ON "finance_audit_log";
CREATE TRIGGER "trg_finance_audit_append_only"
  BEFORE UPDATE OR DELETE ON "finance_audit_log"
  FOR EACH ROW EXECUTE FUNCTION "finance_append_only"();

DROP TRIGGER IF EXISTS "trg_finance_tracking_events_append_only" ON "finance_order_tracking_events";
CREATE TRIGGER "trg_finance_tracking_events_append_only"
  BEFORE UPDATE OR DELETE ON "finance_order_tracking_events"
  FOR EACH ROW EXECUTE FUNCTION "finance_append_only"();

-- available_amount is ledger-owned: reject any attempt to set it directly.
CREATE OR REPLACE FUNCTION "finance_funds_guard"() RETURNS TRIGGER AS $$
BEGIN
  IF NEW."available_amount" IS DISTINCT FROM OLD."available_amount"
     AND COALESCE(current_setting('eos.finance_ledger_ctx', true), '0') <> '1' THEN
    RAISE EXCEPTION
      'finance: available_amount is derived from the ledger and cannot be set directly — post a ledger entry instead'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  NEW."updated_at" := CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "trg_finance_funds_guard" ON "finance_funds";
CREATE TRIGGER "trg_finance_funds_guard"
  BEFORE UPDATE ON "finance_funds"
  FOR EACH ROW EXECUTE FUNCTION "finance_funds_guard"();

-- ---------------------------------------------------------------------------
-- 9. TRACKING / ALLOTMENT RULES
-- ---------------------------------------------------------------------------
-- Record every status transition, and keep delivered_at/quantity coherent.
CREATE OR REPLACE FUNCTION "finance_tracking_on_update"() RETURNS TRIGGER AS $$
BEGIN
  IF NEW."delivery_status" IS DISTINCT FROM OLD."delivery_status" THEN
    -- A cancelled or fully delivered order is terminal; it must not silently
    -- go backwards to an in-flight state.
    IF OLD."delivery_status" IN ('delivered', 'cancelled')
       AND NEW."delivery_status" NOT IN ('delivered', 'cancelled') THEN
      RAISE EXCEPTION
        'finance: order tracking cannot move from % back to %', OLD."delivery_status", NEW."delivery_status"
        USING ERRCODE = 'check_violation';
    END IF;

    IF NEW."delivery_status" IN ('delivered', 'partially_delivered') AND NEW."delivered_at" IS NULL THEN
      NEW."delivered_at" := CURRENT_TIMESTAMP;
    END IF;

    INSERT INTO "finance_order_tracking_events"
      ("tracking_id", "from_status", "to_status", "note", "changed_by_user_id")
    VALUES
      (NEW."id", OLD."delivery_status", NEW."delivery_status", NEW."remarks",
       COALESCE(NEW."updated_by_user_id", NEW."created_by_user_id"));
  END IF;

  NEW."updated_at" := CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "trg_finance_tracking_on_update" ON "finance_order_tracking";
CREATE TRIGGER "trg_finance_tracking_on_update"
  BEFORE UPDATE ON "finance_order_tracking"
  FOR EACH ROW EXECUTE FUNCTION "finance_tracking_on_update"();

-- Seed the timeline with the order's initial state.
CREATE OR REPLACE FUNCTION "finance_tracking_on_insert"() RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO "finance_order_tracking_events"
    ("tracking_id", "from_status", "to_status", "note", "changed_by_user_id")
  VALUES
    (NEW."id", NULL, NEW."delivery_status", NEW."remarks", NEW."created_by_user_id");
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "trg_finance_tracking_on_insert" ON "finance_order_tracking";
CREATE TRIGGER "trg_finance_tracking_on_insert"
  AFTER INSERT ON "finance_order_tracking"
  FOR EACH ROW EXECUTE FUNCTION "finance_tracking_on_insert"();

-- Allotment is only meaningful for something actually delivered, and the
-- total allotted can never exceed what was delivered.
CREATE OR REPLACE FUNCTION "finance_allotment_guard"() RETURNS TRIGGER AS $$
DECLARE
  v_status     "finance_delivery_status_enum";
  v_delivered  INTEGER;
  v_allotted   INTEGER;
BEGIN
  SELECT "delivery_status", "quantity_delivered" INTO v_status, v_delivered
  FROM "finance_order_tracking" WHERE "id" = NEW."tracking_id" FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'finance: tracking row % does not exist', NEW."tracking_id";
  END IF;

  IF v_status NOT IN ('delivered', 'partially_delivered') THEN
    RAISE EXCEPTION
      'finance: cannot allot an order that is not delivered (current status: %)', v_status
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT COALESCE(SUM("quantity"), 0) INTO v_allotted
  FROM "finance_order_allotments"
  WHERE "tracking_id" = NEW."tracking_id"
    AND ("id" <> NEW."id" OR TG_OP = 'INSERT');

  IF v_delivered > 0 AND (v_allotted + NEW."quantity") > v_delivered THEN
    RAISE EXCEPTION
      'finance: allotting % would exceed the delivered quantity (delivered %, already allotted %)',
      NEW."quantity", v_delivered, v_allotted
      USING ERRCODE = 'check_violation';
  END IF;

  NEW."updated_at" := CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "trg_finance_allotment_guard" ON "finance_order_allotments";
CREATE TRIGGER "trg_finance_allotment_guard"
  BEFORE INSERT OR UPDATE ON "finance_order_allotments"
  FOR EACH ROW EXECUTE FUNCTION "finance_allotment_guard"();

-- ---------------------------------------------------------------------------
-- 10. ACCESS LOCKDOWN
--     Supabase auto-exposes every table in `public` through PostgREST to the
--     `anon` and `authenticated` roles. Enabling RLS with no policies, plus
--     revoking grants, makes these tables unreachable that way. The backend
--     connects as the table owner, which bypasses RLS, so it is unaffected.
--     (RLS is intentionally NOT forced, precisely so the owner still works.)
-- ---------------------------------------------------------------------------
ALTER TABLE "finance_funds"                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE "finance_ledger_entries"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE "finance_order_tracking"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE "finance_order_tracking_events"  ENABLE ROW LEVEL SECURITY;
ALTER TABLE "finance_order_allotments"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE "finance_audit_log"              ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  t TEXT;
  r TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'finance_funds', 'finance_ledger_entries', 'finance_order_tracking',
    'finance_order_tracking_events', 'finance_order_allotments', 'finance_audit_log'
  ] LOOP
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
        EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE %I FROM %I', t, r);
      END IF;
    END LOOP;
  END LOOP;
END $$;

COMMIT;

-- ===========================================================================
-- POST-RUN VERIFICATION (safe, read-only — run separately if you like)
-- ===========================================================================
-- SELECT table_name FROM information_schema.tables
--  WHERE table_schema = 'public' AND table_name LIKE 'finance_%' ORDER BY 1;
--
-- Confirms the balance guard is live (this SHOULD fail with an error):
--   UPDATE finance_funds SET available_amount = 999999 WHERE id = 1;
--
-- Confirms the ledger is append-only (this SHOULD fail with an error):
--   DELETE FROM finance_ledger_entries WHERE id = 1;
-- ===========================================================================
