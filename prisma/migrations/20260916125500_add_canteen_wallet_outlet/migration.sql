-- Adds the missing 'canteen' outlet type so canteen purchase debits can
-- satisfy chk_wallet_transactions_source, which requires outlet_id for any
-- source='purchase' + txn_type='debit' row (a pre-existing rule, discovered
-- live via a real failed debit, not something invented for this feature).
-- Must run as its own statement — Postgres won't let a new enum value be
-- used in the same transaction that adds it.
ALTER TYPE wallet_outlet_type_enum ADD VALUE IF NOT EXISTS 'canteen';

-- Applied in a separate step after the enum value above (Postgres forbids
-- using a brand-new enum value in the same transaction that added it):
-- INSERT INTO wallet_outlets (name, outlet_type) VALUES ('Canteen', 'canteen');
