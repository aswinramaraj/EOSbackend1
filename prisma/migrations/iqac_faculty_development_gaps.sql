-- Faculty Development metric pages (IQAC): Publications is now fully real
-- (faculty_publications, already in schema). FDP, STTP, Certifications,
-- Research and Patents have zero real backing — grepped the whole schema,
-- nothing tracks faculty development/training programme attendance,
-- faculty-level skill certifications, research centres/projects/
-- investigator roles (department_research_funding is department-scoped
-- funding, a different concept), or patents anywhere. These tables mirror
-- the reference design's own cohort shapes for these metrics. I have not
-- run this and will not run it myself, per the standing rule. Run it
-- yourself, then `npx prisma db pull` + `npx prisma generate` same as
-- every prior migration this session.

-- FDP and STTP share one table — the mock's own two cohort defs are
-- structurally identical (PROGRAMME/HOST-or-AGENCY/DURATION/DATE/STATUS),
-- distinguished only by program_type.
CREATE TABLE faculty_development_programs (
  id SERIAL PRIMARY KEY,
  faculty_id INT NOT NULL REFERENCES faculty(id),
  program_type VARCHAR(10) NOT NULL CHECK (program_type IN ('fdp', 'sttp')),
  programme_name VARCHAR(255) NOT NULL,
  host_agency VARCHAR(255),
  duration VARCHAR(50), -- free text, e.g. '5 days', '2 weeks'
  attended_on DATE,
  status VARCHAR(30) NOT NULL DEFAULT 'registered', -- certificate_awarded / completed / ongoing / registered
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_faculty_development_programs_faculty ON faculty_development_programs(faculty_id);

CREATE TABLE faculty_certifications (
  id SERIAL PRIMARY KEY,
  faculty_id INT NOT NULL REFERENCES faculty(id),
  platform VARCHAR(100) NOT NULL,
  track VARCHAR(255) NOT NULL,
  score VARCHAR(20),
  completed_on DATE,
  status VARCHAR(30) NOT NULL DEFAULT 'enrolled', -- certified / certificate_pending / enrolled / not_qualified
  certificate_url VARCHAR(500),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_faculty_certifications_faculty ON faculty_certifications(faculty_id);

CREATE TABLE faculty_research_projects (
  id SERIAL PRIMARY KEY,
  centre_name VARCHAR(255) NOT NULL, -- 'Centre of Excellence in AI'
  focus_area VARCHAR(255),
  status VARCHAR(30) NOT NULL DEFAULT 'ongoing', -- ongoing / completed / proposal_stage / on_hold
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE faculty_research_project_members (
  id SERIAL PRIMARY KEY,
  project_id INT NOT NULL REFERENCES faculty_research_projects(id),
  faculty_id INT NOT NULL REFERENCES faculty(id),
  role VARCHAR(50) NOT NULL, -- 'Principal investigator' / 'Co-investigator' / 'Research member'
  joined_on DATE,
  UNIQUE (project_id, faculty_id)
);
CREATE INDEX idx_faculty_research_project_members_faculty ON faculty_research_project_members(faculty_id);

CREATE TABLE faculty_patents (
  id SERIAL PRIMARY KEY,
  title VARCHAR(500) NOT NULL,
  stage VARCHAR(30) NOT NULL DEFAULT 'filed', -- granted / published / filed / under_examination
  filed_year INT,
  stage_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE faculty_patent_inventors (
  id SERIAL PRIMARY KEY,
  patent_id INT NOT NULL REFERENCES faculty_patents(id),
  faculty_id INT NOT NULL REFERENCES faculty(id),
  role VARCHAR(30) NOT NULL, -- 'Lead inventor' / 'Co-inventor'
  UNIQUE (patent_id, faculty_id)
);
CREATE INDEX idx_faculty_patent_inventors_faculty ON faculty_patent_inventors(faculty_id);
