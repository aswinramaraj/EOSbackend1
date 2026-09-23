-- Placement Cell to-dos: adds an optional PDF attachment and/or link per
-- to-do (Placement staff can post either, both, or neither). Purely
-- additive - no other columns/tables touched.
BEGIN;

ALTER TABLE placement_todos
  ADD COLUMN IF NOT EXISTS pdf_url VARCHAR(500),
  ADD COLUMN IF NOT EXISTS link_url VARCHAR(500);

COMMIT;
