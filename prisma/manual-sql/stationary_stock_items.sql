-- Stationary Portal Dashboard's "Stock alerts" panel (paper/spiral-comb/
-- lamination-pouch levels) - new table, user-approved before creation.
-- full_stock_quantity is "what 100% looks like" for that item, so the
-- dashboard bar can render quantity_left / full_stock_quantity as a percent
-- rather than an arbitrary/unscaled number.
CREATE TABLE IF NOT EXISTS stationary_stock_items (
  id SERIAL PRIMARY KEY,
  item_name VARCHAR(150) NOT NULL UNIQUE,
  unit VARCHAR(50) NOT NULL,
  quantity_left INTEGER NOT NULL DEFAULT 0,
  full_stock_quantity INTEGER NOT NULL,
  low_stock_threshold INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP(3) NOT NULL DEFAULT now(),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT now()
);

-- Seed with the counter's real current levels (vendor can adjust from the
-- dashboard once live) - starting figures match what the design reference
-- showed, used here as a realistic first snapshot rather than invented.
INSERT INTO stationary_stock_items (item_name, unit, quantity_left, full_stock_quantity, low_stock_threshold)
VALUES
  ('A4 paper', 'reams', 34, 50, 15),
  ('A3 paper', 'reams', 9, 41, 15),
  ('Spiral combs', 'pieces', 60, 200, 40),
  ('Lamination pouches', 'pieces', 210, 250, 50)
ON CONFLICT (item_name) DO NOTHING;
