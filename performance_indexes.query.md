## 1. Missing indexes on hot-path tables (HOD/faculty/student dashboards, timetable, attendance)

**Why**
- Confirmed live against `pg_indexes` on 2026-09-15 (not just trusted from the Sep 8 audit doc) — all 6 tables below are still missing these indexes today.
- Each is hit on a high-frequency read path: HOD dashboard pending-approvals count, "my timetable today" (one of the highest-frequency reads in the app), marksheet lookups, the results-published gate checked on nearly every student request during a results window, and class-mentor screens.
- All additive, zero behavioral risk — no existing query changes, no data changes.

**What it does**
- `marksheets`: adds `student_id`, `exam_id` — every "get a student's marksheets" / "marksheets for an exam" query currently seq-scans past only a PK index.
- `faculty_subject_class_mapping`: adds `faculty_id` — this table gates every attendance-marking action (`markForClass`/`publishForClass`/`getDraftForClass` all `findFirst({where:{faculty_id,...}})`), an authorization check on a hot write path.
- `result_publications`: adds `exam_id` — the "has this exam's results been published?" gate.
- `timetable_slots`: adds `(faculty_id, day_of_week)` and `(class_id, day_of_week)` — currently only `venue_id` + PK are indexed.
- `faculty_leaves`: adds `faculty_id` and `hod_approval_status` — currently zero indexes beyond PK, yet the HOD dashboard does `count({where:{hod_approval_status:'pending', faculty:{department_id}}})`.
- `students`: adds `mentor_faculty_id` — backs "my advisees" (class-mentor) screens.

```sql
-- Run outside a transaction block — CONCURRENTLY cannot run inside one.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_marksheets_student ON marksheets (student_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_marksheets_exam ON marksheets (exam_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_faculty_subject_class_mapping_faculty ON faculty_subject_class_mapping (faculty_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_result_publications_exam ON result_publications (exam_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_timetable_slots_faculty_day ON timetable_slots (faculty_id, day_of_week);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_timetable_slots_class_day ON timetable_slots (class_id, day_of_week);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_faculty_leaves_faculty ON faculty_leaves (faculty_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_faculty_leaves_hod_approval_status ON faculty_leaves (hod_approval_status);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_students_mentor_faculty ON students (mentor_faculty_id);
```

**Left for you:** run this against the live Supabase DB yourself (each `CREATE INDEX CONCURRENTLY` is its own statement — safe to run one at a time if preferred). Nothing in `schema.prisma` needs to change for these to take effect at runtime (indexes aren't referenced by application code), but run `npx prisma db pull` afterward anyway so `schema.prisma`'s `@@index` annotations stay accurate for the next person reading it.

**Status:** not yet applied — proposed here, not run. No application code depends on these existing, so nothing breaks either way until you run it; this only makes the already-issued queries faster.

---

## 2. (placeholder — add further entries here only if later baseline work surfaces a genuine additional index gap)

The HOD dashboard's `cgpaCte` query was checked via `EXPLAIN (ANALYZE, BUFFERS)` on 2026-09-15 and is **not** in this list — it already uses `idx_students_class` and `idx_exam_marks_student` correctly (index scans, 100% buffer cache hits, no missing-index issue). Its cost is round-trip count and a per-row correlated grade-band lookup, not a missing index — see `docs/performance/PERFORMANCE_BASELINE.md` (or the discovery plan, if that file doesn't exist yet) for detail.
