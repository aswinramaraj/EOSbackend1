-- Lets the Academic Coordinator tag a feedback_forms row as a specific
-- campus service (Food Court/Medical/Library/Stationary/Copy Center)
-- instead of - or alongside - the existing academic class/batch targeting.
-- Purely additive: NULL (the default) means "an ordinary academic form",
-- unchanged behavior for every existing row and every existing endpoint.
BEGIN;

DO $$ BEGIN
  CREATE TYPE feedback_service_type_enum AS ENUM (
    'food_court',
    'medical',
    'library',
    'stationary',
    'copy_center'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE feedback_forms
  ADD COLUMN IF NOT EXISTS service_type feedback_service_type_enum;

COMMIT;
