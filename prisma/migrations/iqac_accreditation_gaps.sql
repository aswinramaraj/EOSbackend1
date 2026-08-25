-- Accreditation metric pages (IQAC): NBA progress is now fully real —
-- nba_criteria/nba_evidence_items already exist and already back
-- Secretary Portal's own Accreditation Documentation screen (reused here
-- via AccreditationService, not re-queried). NAAC progress, AQAR progress
-- and SSR progress have no real backing: nba_criteria is specifically
-- NBA-shaped (department-scoped programme accreditation — a genuinely
-- different real process from NAAC/AQAR/SSR, which are institution-wide),
-- and nothing else tracks criteria/evidence for those three anywhere.
-- This table pair mirrors nba_criteria/nba_evidence_items in shape but
-- generalized institution-wide (no department_id) with a `cycle` column
-- covering all three, plus an `owner` field the NBA table doesn't have
-- (the reference design's checklist shows an owner per criterion). I have
-- not run this and will not run it myself, per the standing rule. Run it
-- yourself, then `npx prisma db pull` + `npx prisma generate` same as
-- every prior migration this session.

CREATE TABLE iqac_accreditation_criteria (
  id SERIAL PRIMARY KEY,
  cycle VARCHAR(10) NOT NULL CHECK (cycle IN ('naac', 'aqar', 'ssr')),
  code VARCHAR(20) NOT NULL, -- 'C1'..'C7' for NAAC, or the AQAR/SSR section code
  name VARCHAR(255) NOT NULL,
  owner_faculty_id INT REFERENCES faculty(id),
  sort_order INT NOT NULL DEFAULT 0,
  UNIQUE (cycle, code)
);

CREATE TABLE iqac_accreditation_evidence_items (
  id SERIAL PRIMARY KEY,
  criterion_id INT NOT NULL REFERENCES iqac_accreditation_criteria(id),
  label VARCHAR(255) NOT NULL,
  done BOOLEAN NOT NULL DEFAULT false,
  updated_by_user_id INT REFERENCES users(id),
  updated_at TIMESTAMPTZ
);
CREATE INDEX idx_iqac_accreditation_evidence_items_criterion ON iqac_accreditation_evidence_items(criterion_id);
