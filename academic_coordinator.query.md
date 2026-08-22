## 1. Course Outcomes, Program Outcomes, and the CO–PO mapping matrix

**Why**
- Reference UI's "CO – PO Mapping" page needs a CO–PO correlation matrix (CO1..COn rows × PO1..POn columns, each cell 1/2/3 = weak/moderate/strong) plus an attainment figure per CO.
- Nothing like this exists anywhere in the schema — confirmed via full search (no `course_outcome`, `program_outcome`, `co_po`, or `attainment` tables). The only accreditation-adjacent tables are an empty, unrelated `nba_criteria`/`nba_evidence_items` checklist.
- This is new ground, not a gap in an existing table — 3 new tables, fully additive, touching nothing else.

**What it does**
- `program_outcomes`: the fixed PO list (e.g. PO1–PO12), scoped per department since different departments/programs can define their own POs.
- `course_outcomes`: the CO list (e.g. CO1–CO5) per subject.
- `co_po_mapping`: one row per matrix cell — a course outcome mapped to a program outcome with a correlation level.
- Attainment is deliberately **not** a stored column — it's computed live from real `exam_marks` performance against subjects mapped to each CO, the same way the Principal module already computes CGPA live via `$queryRaw` rather than storing it. Storing a number that silently goes stale would be worse than computing it fresh each time.

```sql
CREATE TABLE IF NOT EXISTS program_outcomes (
  id SERIAL PRIMARY KEY,
  department_id INT NOT NULL REFERENCES departments(id),
  code VARCHAR(10) NOT NULL,
  description TEXT NOT NULL,
  display_order SMALLINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (department_id, code)
);

CREATE TABLE IF NOT EXISTS course_outcomes (
  id SERIAL PRIMARY KEY,
  subject_id INT NOT NULL REFERENCES subjects(id),
  code VARCHAR(10) NOT NULL,
  description TEXT NOT NULL,
  display_order SMALLINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (subject_id, code)
);

CREATE TABLE IF NOT EXISTS co_po_mapping (
  id SERIAL PRIMARY KEY,
  course_outcome_id INT NOT NULL REFERENCES course_outcomes(id) ON DELETE CASCADE,
  program_outcome_id INT NOT NULL REFERENCES program_outcomes(id) ON DELETE CASCADE,
  correlation_level SMALLINT NOT NULL CHECK (correlation_level BETWEEN 1 AND 3),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (course_outcome_id, program_outcome_id)
);
```

**Left for you:** run this migration; the Academic Coordinator then defines POs per department and COs per subject through the module itself — no seed data needed, the page's empty state handles a fresh table honestly.

**Status:** code uses `$queryRaw`/`$executeRaw` with try-catch fallback so the CO-PO Mapping page activates the moment these tables exist; until then it shows an honest "not set up yet" state rather than fabricated data.

---

## 2. (placeholder — add further entries here only if later pages surface a genuine gap)

Everything else in the Academic Coordinator module (Faculty Workload, Timetable, Attendance, Examinations, Internal Marks, Course Progress, Results, Academic Audit, Curriculum Create/Map, Feedback, Academic Calendar, Reports) is being built against tables that already exist in the live database — see the module's own research notes for exactly which tables back each page. No further schema changes are anticipated; this file will be updated if that changes.
