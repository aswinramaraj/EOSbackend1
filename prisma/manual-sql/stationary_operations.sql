-- Stationary Portal Operations page ("Printers & Machines" + "Price Detail"
-- tabs) - 3 new tables, user-approved before creation.

CREATE TABLE IF NOT EXISTS stationary_machines (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  model VARCHAR(150) NOT NULL,
  category VARCHAR(20) NOT NULL DEFAULT 'printer', -- 'printer' | 'binding' (icon selection only)
  status VARCHAR(20) NOT NULL DEFAULT 'working',   -- 'working' | 'under_repair' | 'maintenance'
  note VARCHAR(300),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP(3) NOT NULL DEFAULT now(),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS stationary_print_rates (
  id SERIAL PRIMARY KEY,
  service VARCHAR(100) NOT NULL,
  paper_size VARCHAR(20) NOT NULL,
  bw_price DECIMAL(10,2) NOT NULL,
  bw_unit VARCHAR(20) NOT NULL,      -- e.g. "page", "sheet"
  colour_price DECIMAL(10,2) NOT NULL,
  colour_unit VARCHAR(20) NOT NULL,
  bulk_price DECIMAL(10,2) NOT NULL,
  bulk_unit VARCHAR(20) NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP(3) NOT NULL DEFAULT now(),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS stationary_finishing_rates (
  id SERIAL PRIMARY KEY,
  item_name VARCHAR(100) NOT NULL,
  note VARCHAR(150),
  price DECIMAL(10,2) NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP(3) NOT NULL DEFAULT now(),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT now()
);

-- Seed with the design reference's own machines/rates - a realistic
-- starting point the vendor can edit once live, not fabricated filler.
INSERT INTO stationary_machines (name, model, category, status, note, sort_order) VALUES
  ('Ricoh MP 5055', 'Mono multifunction · Counter 1', 'printer', 'working', 'Handles the bulk B&W queue. Last serviced 28 Aug 2026.', 1),
  ('Konica C3070', 'Colour production · Counter 2', 'printer', 'working', 'Cyan cartridge to be replaced before the next colour bulk job.', 2),
  ('HP LaserJet M436', 'Mono A3 · Drawing section', 'printer', 'under_repair', 'Fuser unit failure reported 13 Sep. Vendor visit expected 16 Sep.', 3),
  ('Canon iR 2625', 'Mono multifunction · Back office', 'printer', 'maintenance', 'Scheduled drum cleaning on 16 Sep, 14:00 to 15:30.', 4),
  ('GBC CombBind C210', 'Spiral & comb binding', 'binding', 'working', 'Comb spine stock running low: 60 pieces left.', 5),
  ('Fellowes Saturn A3', 'Lamination · Counter 1', 'binding', 'working', 'A3 pouches restocked on 12 Sep.', 6)
ON CONFLICT DO NOTHING;

INSERT INTO stationary_print_rates (service, paper_size, bw_price, bw_unit, colour_price, colour_unit, bulk_price, bulk_unit, sort_order) VALUES
  ('Print · single side', 'A4', 1.00, 'page', 8.00, 'page', 0.90, 'page', 1),
  ('Print · double side', 'A4', 1.60, 'sheet', 14.00, 'sheet', 1.40, 'sheet', 2),
  ('Print · single side', 'A3', 3.00, 'page', 18.00, 'page', 2.60, 'page', 3),
  ('Photocopy', 'A4', 0.80, 'page', 6.00, 'page', 0.70, 'page', 4),
  ('Poster print · matte', 'A3', 12.00, 'sheet', 60.00, 'sheet', 54.00, 'sheet', 5),
  ('Scan to email', 'A4 / A3', 2.00, 'page', 2.00, 'page', 1.50, 'page', 6)
ON CONFLICT DO NOTHING;

INSERT INTO stationary_finishing_rates (item_name, note, price, sort_order) VALUES
  ('Spiral binding', 'up to 200 pages', 40, 1),
  ('Comb binding', 'up to 150 pages', 35, 2),
  ('Soft bind with cover', 'project reports', 120, 3),
  ('Lamination', 'A4 / A3 pouch', 15, 4)
ON CONFLICT DO NOTHING;
