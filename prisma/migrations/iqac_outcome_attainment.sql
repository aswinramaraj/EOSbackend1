-- IQAC "Course attainment" / "Program attainment" metric pages have zero
-- real backing today — not just the target figure, the entire CO/PO
-- structure. Grepped the whole schema: curriculum_mappings only records
-- which subject belongs to which department+semester, nothing maps a
-- subject to its Course Outcomes, nothing maps a CO to a Program Outcome,
-- and no table stores an attainment level anywhere. Full NBA-style
-- question-level CO attainment (each exam question mapped to a CO with its
-- own weightage) is a much bigger undertaking than this file — these 3
-- tables cover the more common real pattern instead: IQAC/faculty enter
-- the direct/indirect attainment they've already worked out elsewhere,
-- once per outcome per year. I have not run this and will not run it
-- myself, per the standing rule. Run it yourself, then `npx prisma db pull`
-- + `npx prisma generate` same as every prior migration this session.

CREATE TABLE program_outcomes (
  id SERIAL PRIMARY KEY,
  department_id INT NOT NULL REFERENCES departments(id),
  code VARCHAR(10) NOT NULL, -- 'PO1'..'PO12'
  description VARCHAR(255) NOT NULL,
  UNIQUE (department_id, code)
);

CREATE TABLE course_outcomes (
  id SERIAL PRIMARY KEY,
  subject_id INT NOT NULL REFERENCES subjects(id),
  code VARCHAR(10) NOT NULL, -- 'CO1'..'CO5'
  description VARCHAR(255) NOT NULL,
  UNIQUE (subject_id, code)
);

CREATE TABLE outcome_attainments (
  id SERIAL PRIMARY KEY,
  outcome_type VARCHAR(10) NOT NULL CHECK (outcome_type IN ('course', 'program')),
  course_outcome_id INT REFERENCES course_outcomes(id),
  program_outcome_id INT REFERENCES program_outcomes(id),
  academic_year VARCHAR(20) NOT NULL,
  batch_id INT REFERENCES batches(id),
  direct_value NUMERIC(4,2),
  indirect_value NUMERIC(4,2),
  target_value NUMERIC(4,2) NOT NULL DEFAULT 2.80,
  attained_value NUMERIC(4,2),
  entered_by_user_id INT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (
    (outcome_type = 'course' AND course_outcome_id IS NOT NULL AND program_outcome_id IS NULL) OR
    (outcome_type = 'program' AND program_outcome_id IS NOT NULL AND course_outcome_id IS NULL)
  )
);
CREATE INDEX idx_outcome_attainments_course ON outcome_attainments(course_outcome_id);
CREATE INDEX idx_outcome_attainments_program ON outcome_attainments(program_outcome_id);
