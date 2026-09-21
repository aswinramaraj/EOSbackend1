-- Stationery Store Admin (web) — a brand-new, standalone role/login, kept
-- deliberately separate from the pre-existing 'stationary' print-shop role
-- (explicit user instruction: "don't link both logins"). Purely additive:
-- one new roles row, one new users row, one new nullable-with-default
-- column on stationery_products. No other tables touched.
BEGIN;

INSERT INTO roles (name, description)
VALUES ('stationery', 'Stationery Store Admin')
ON CONFLICT (name) DO NOTHING;

-- Universal test password EOS@test123, hashed the same way auth.service.ts
-- hashes every password (sha256 hex, no salt — see login()).
INSERT INTO users (email, password_hash, role_id, status)
SELECT 'stationery@sece.ac.in',
       '1e9b38de300be8453122d0138c5854010c9dc0587c53ceab4d9bcd14db882816',
       r.id,
       'active'
FROM roles r
WHERE r.name = 'stationery'
ON CONFLICT (email) DO NOTHING;

ALTER TABLE stationery_products
  ADD COLUMN IF NOT EXISTS low_stock_threshold INTEGER NOT NULL DEFAULT 10;

COMMIT;
