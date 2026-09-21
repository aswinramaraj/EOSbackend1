-- Per-dish parcel eligibility (e.g. cold drinks can't be parceled) —
-- additive only, cross-verified against the live DB before applying.
-- Defaults true so every existing dish keeps working exactly as before;
-- Canteen Admin turns it off per-dish where it doesn't make sense.
ALTER TABLE canteen_dishes ADD COLUMN parcel_available BOOLEAN NOT NULL DEFAULT true;
