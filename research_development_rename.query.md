## 1. Publications: drop `faculty_` prefix, add multi-contributor support

**Why**
- Publications is no longer faculty-exclusive — students can be contributors too.
- `faculty_publications` is a flat single-author table (`faculty_id`, `author_role`) — no join table exists yet, so a real child table is needed, not just a rename.
- Code already handles both pre- and post-migration shape via `src/common/db/publications-table.util.ts` — safe to run whenever, nothing breaks if it's delayed.

**What it does**
- Renames `faculty_publications` → `publications`.
- Adds `publication_contributors`: one row per contributor, `faculty_id` XOR `student_id`, tagged `role` (`primary_author` / `secondary_author`).
- Backfills every existing publication into `publication_contributors` as its one on-file author, mapping legacy `author_role` (`first_author`/`corresponding_author` → `primary_author`, everything else → `secondary_author`) — same mapping the app's own pre-migration fallback already uses, so the backfilled data matches what was already being shown.
- Final step (commented out): drops the now-redundant `faculty_id`/`author_role` columns from `publications` — run only after verifying the backfill row count matches.

```sql
ALTER TABLE faculty_publications RENAME TO publications;

CREATE TABLE IF NOT EXISTS publication_contributors (
  id SERIAL PRIMARY KEY,
  publication_id INT NOT NULL REFERENCES publications(id) ON DELETE CASCADE,
  faculty_id INT REFERENCES faculty(id),
  student_id INT REFERENCES students(id),
  role VARCHAR(30) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((faculty_id IS NOT NULL)::int + (student_id IS NOT NULL)::int = 1)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_publication_contributors_faculty
  ON publication_contributors (publication_id, faculty_id) WHERE faculty_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_publication_contributors_student
  ON publication_contributors (publication_id, student_id) WHERE student_id IS NOT NULL;

INSERT INTO publication_contributors (publication_id, faculty_id, role)
SELECT id, faculty_id,
  CASE WHEN author_role IN ('first_author', 'corresponding_author')
       THEN 'primary_author' ELSE 'secondary_author' END
FROM publications;

-- Run only after verifying: SELECT count(*) FROM publication_contributors
-- matches SELECT count(*) FROM publications.
-- ALTER TABLE publications DROP COLUMN faculty_id, DROP COLUMN author_role;
```

**Left for you:** run the SQL above (the final `DROP COLUMN` line stays commented out — uncomment and run separately once you've checked the backfill count), then `prisma db pull && prisma generate`.

**Status:** not yet run. Code uses `$queryRaw`/`$executeRaw` with a resolved-table-name + try/catch fallback (`publications-table.util.ts`), so Publications keeps working against the old `faculty_publications` shape (single author, no contributor picker) until this runs.

---

## 2. Research & Patents: drop `faculty_` prefix, allow student contributors

**Why**
- Same universal-contributor requirement as Publications, but Research and Patents already have proper join tables (`faculty_research_project_members`, `faculty_patent_inventors`, both already `@@unique(parent_id, faculty_id)` + a `role` column) — this is a rename + a nullable `student_id` column, not a new table.

**What it does**
- Renames `faculty_research_projects` → `research_projects`, `faculty_research_project_members` → `research_project_members`.
- Renames `faculty_patents` → `patents`, `faculty_patent_inventors` → `patent_inventors`.
- On both member tables: relaxes `faculty_id` to nullable, adds nullable `student_id`, adds a CHECK that exactly one of the two is set, adds a partial unique index on `(parent_id, student_id)` so student contributors get the same upsert-safety faculty contributors already have via the existing `(parent_id, faculty_id)` unique constraint (which survives the rename untouched).

```sql
ALTER TABLE faculty_research_projects RENAME TO research_projects;
ALTER TABLE faculty_research_project_members RENAME TO research_project_members;
ALTER TABLE research_project_members ALTER COLUMN faculty_id DROP NOT NULL;
ALTER TABLE research_project_members ADD COLUMN student_id INT REFERENCES students(id);
ALTER TABLE research_project_members
  ADD CONSTRAINT chk_research_project_members_person
  CHECK ((faculty_id IS NOT NULL)::int + (student_id IS NOT NULL)::int = 1);
CREATE UNIQUE INDEX IF NOT EXISTS uq_research_project_members_student
  ON research_project_members (project_id, student_id) WHERE student_id IS NOT NULL;

ALTER TABLE faculty_patents RENAME TO patents;
ALTER TABLE faculty_patent_inventors RENAME TO patent_inventors;
ALTER TABLE patent_inventors ALTER COLUMN faculty_id DROP NOT NULL;
ALTER TABLE patent_inventors ADD COLUMN student_id INT REFERENCES students(id);
ALTER TABLE patent_inventors
  ADD CONSTRAINT chk_patent_inventors_person
  CHECK ((faculty_id IS NOT NULL)::int + (student_id IS NOT NULL)::int = 1);
CREATE UNIQUE INDEX IF NOT EXISTS uq_patent_inventors_student
  ON patent_inventors (patent_id, student_id) WHERE student_id IS NOT NULL;
```

**Left for you:** run the SQL above, then `prisma db pull && prisma generate`.

**Status:** not yet run. Code uses the same resolved-table-name + try/catch pattern (`getResearchProjectsTable`/`getResearchMembersTable`/`getPatentsTable`/`getPatentInventorsTable` in `publications-table.util.ts`), so Research and Patents keep working against the old faculty-only shape until this runs — `researchAcceptsStudents()`/`patentsAcceptStudents()` gate the student-contributor UI/validation on whether the rename has landed.
