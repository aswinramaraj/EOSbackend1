-- Media Room second-wave register tables.
-- Not in schema.prisma by design — accessed only via $queryRaw/$executeRaw.
-- Run this once against the Supabase DB, in this order (FK dependencies).

CREATE TABLE IF NOT EXISTS media_team_members (
  id SERIAL PRIMARY KEY,
  full_name VARCHAR(150) NOT NULL,
  designation VARCHAR(100),
  email VARCHAR(150),
  phone VARCHAR(20),
  skills TEXT,
  photo_url TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'active',       -- active | inactive
  joined_on DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by_user_id INT REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS media_equipment (
  id SERIAL PRIMARY KEY,
  asset_tag VARCHAR(30) UNIQUE,                       -- e.g. MR-CAM-015
  name VARCHAR(150) NOT NULL,
  category VARCHAR(30) NOT NULL,                      -- camera | lens | support | audio | lighting | aerial
  serial_no VARCHAR(100),
  condition VARCHAR(20) NOT NULL DEFAULT 'good',      -- good | fair | needs_repair
  status VARCHAR(20) NOT NULL DEFAULT 'available',    -- available | checked_out | in_service | retired
  checked_out_to VARCHAR(150),
  purchased_on DATE,
  invoice_value NUMERIC(12, 2),
  warranty_till DATE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by_user_id INT REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS media_equipment_movements (
  id SERIAL PRIMARY KEY,
  equipment_id INT NOT NULL REFERENCES media_equipment(id) ON DELETE CASCADE,
  moved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  note VARCHAR(255) NOT NULL,
  created_by_user_id INT REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS media_shoot_assignments (
  id SERIAL PRIMARY KEY,
  media_request_id INT NOT NULL REFERENCES media_requests(id) ON DELETE CASCADE,
  assigned_to_member_id INT REFERENCES media_team_members(id) ON DELETE SET NULL,
  crew VARCHAR(255),                                  -- free-text names, since a shoot is often more than one assignee
  gear_issued VARCHAR(255),
  output_type VARCHAR(100),                            -- e.g. "Photos + reel"
  scheduled_at TIMESTAMPTZ,
  status VARCHAR(20) NOT NULL DEFAULT 'planned',       -- planned | confirmed | delivered | cancelled
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by_user_id INT NOT NULL REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS media_indents (
  id SERIAL PRIMARY KEY,
  requested_by_user_id INT NOT NULL REFERENCES users(id),
  title VARCHAR(200) NOT NULL,
  indent_type VARCHAR(30) NOT NULL DEFAULT 'capital_equipment', -- capital_equipment | consumables | repair_service | rental_hire
  quantity INT NOT NULL DEFAULT 1,
  estimated_cost NUMERIC(12, 2),
  needed_by DATE,
  budget_head VARCHAR(30) NOT NULL DEFAULT 'media_branding',    -- media_branding | institution_events | admissions_outreach
  justification TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',      -- pending | approved | rejected | fulfilled
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  resolution_notes TEXT
);
