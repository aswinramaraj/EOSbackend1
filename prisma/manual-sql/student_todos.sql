-- Placement Cell to-do broadcast. A placement staff account posts a to-do
-- (e.g. "Register for TCS CodeVita Contest"); every student sees it in the
-- mobile app's Placements -> Todo tab and can mark it done. Brand new
-- feature - no prior table existed for this (see TodoTabBody.tsx's own
-- former comment: "no backend concept of a unified cross-department to-do
-- list exists yet"). Per this project's "never modify schema.prisma for a
-- small additive table" convention, these are raw-SQL tables (see
-- StudentTodosService) rather than schema.prisma models.

CREATE TABLE IF NOT EXISTS placement_todos (
  id SERIAL PRIMARY KEY,
  title VARCHAR(200) NOT NULL,
  description VARCHAR(2000),
  deadline TIMESTAMPTZ,
  created_by_user_id INTEGER NOT NULL REFERENCES users(id),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row per student who has marked a given to-do done - existence of the
-- row IS the "completed" flag (no separate boolean needed).
CREATE TABLE IF NOT EXISTS student_todo_completions (
  id SERIAL PRIMARY KEY,
  todo_id INTEGER NOT NULL REFERENCES placement_todos(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (todo_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_student_todo_completions_todo ON student_todo_completions(todo_id);
