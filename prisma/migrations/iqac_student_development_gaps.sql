-- Student Development metric pages (IQAC): Placements and Awards are now
-- fully real (placement_drives/student_drive_applications, and
-- sports_achievements via the sports-admin AchievementsService).
-- Certifications, Competitions and Hackathons have zero real backing —
-- grepped the whole schema, nothing tracks skill certifications
-- (student_certificates is a different concept: administrative documents
-- like Conduct/Transfer certificates, not NPTEL/AWS/Coursera-style ones),
-- non-sports competitions, or hackathon participation anywhere. These 3
-- tables mirror the shapes the reference design's own cohort records use
-- for these metrics (PLATFORM/TRACK/SCORE/STATUS, EVENT/CATEGORY/LEVEL/
-- RESULT, HACKATHON/TEAM/HOST/OUTCOME). I have not run this and will not
-- run it myself, per the standing rule. Run it yourself, then
-- `npx prisma db pull` + `npx prisma generate` same as every prior
-- migration this session.

CREATE TABLE student_certifications (
  id SERIAL PRIMARY KEY,
  student_id INT NOT NULL REFERENCES students(id),
  platform VARCHAR(100) NOT NULL, -- 'NPTEL', 'AWS Academy', 'Coursera', ...
  track VARCHAR(255) NOT NULL, -- 'Core engineering', 'Cloud practitioner', ...
  score VARCHAR(20), -- free text, e.g. '92%'
  completed_on DATE,
  status VARCHAR(30) NOT NULL DEFAULT 'enrolled', -- certified / certificate_pending / enrolled / not_qualified
  certificate_url VARCHAR(500),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_student_certifications_student ON student_certifications(student_id);

CREATE TABLE student_competitions (
  id SERIAL PRIMARY KEY,
  student_id INT NOT NULL REFERENCES students(id),
  event_name VARCHAR(255) NOT NULL,
  category VARCHAR(100), -- 'Competitive programming', 'Robotics', ...
  level VARCHAR(50), -- 'National' / 'State' / 'Regional' / 'International'
  held_on DATE,
  result VARCHAR(50), -- 'Winner' / 'Runner up' / 'Finalist' / 'Participated'
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_student_competitions_student ON student_competitions(student_id);

CREATE TABLE student_hackathon_participations (
  id SERIAL PRIMARY KEY,
  student_id INT NOT NULL REFERENCES students(id),
  hackathon_name VARCHAR(255) NOT NULL,
  team_name VARCHAR(100),
  host VARCHAR(255),
  held_on DATE,
  outcome VARCHAR(50), -- 'Winner' / 'Finalist' / 'Shortlisted' / 'Participated'
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_student_hackathon_participations_student ON student_hackathon_participations(student_id);
