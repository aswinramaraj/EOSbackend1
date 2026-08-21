-- Genuine schema gaps confirmed during the Student/Faculty Profile build
-- (exhaustive audit — grep the schema yourself if you want to double-check
-- before running this, none of these exist anywhere under any name):
--   - Faculty publications/citations (no journals/conferences/citations table)
--   - Faculty-level awards (sports_achievements/department_achievements are
--     student/department scoped, not faculty)
--   - Committee/coordinator responsibilities beyond class-advisor + teaching
--     (no membership table for anti-ragging/NBA/library-advisory etc.)
--   - A dedicated staff ID code (only faculty.id/user_id exist)
--
-- Purely additive — no existing table/column is touched. I have not run
-- this and will not run it myself, per the standing rule to never touch
-- schema.prisma or migrate directly. Run it yourself, then
-- `npx prisma db pull` + `npx prisma generate` same as before.

CREATE TABLE faculty_publications (
  id serial PRIMARY KEY,
  faculty_id int NOT NULL REFERENCES faculty(id),
  title varchar(500) NOT NULL,
  type varchar(30) NOT NULL CHECK (type IN ('journal','conference','book_chapter')),
  year int,
  venue varchar(255),
  doi varchar(100),
  citation_count int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE faculty_awards (
  id serial PRIMARY KEY,
  faculty_id int NOT NULL REFERENCES faculty(id),
  title varchar(255) NOT NULL,
  awarded_by varchar(255),
  year int,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE faculty_committee_roles (
  id serial PRIMARY KEY,
  faculty_id int NOT NULL REFERENCES faculty(id),
  committee_name varchar(255) NOT NULL,
  role varchar(100),
  academic_year varchar(20)
);

ALTER TABLE faculty ADD COLUMN staff_code varchar(30) UNIQUE;

-- Optional, only if you want a distinct non-parent "Guardian" contact
-- separate from father/mother in student_family_details:
ALTER TABLE student_family_details
  ADD COLUMN guardian_name varchar(150),
  ADD COLUMN guardian_relationship varchar(50),
  ADD COLUMN guardian_phone varchar(20),
  ADD COLUMN guardian_email citext;
