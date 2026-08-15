## 1. Industry, location, recruiter SPOC, expected package (Placement's Add company form)

**Why**
- Reference design's "Add company" form and the Companies table have Industry, Location, Recruiter SPOC and Expected average package fields.
- `companies` only has `name`/`profile_info`/`created_at` — nothing else exists, so these were all showing an honest "—" until now.

**What it does**
- Adds 4 nullable columns to the existing `companies` table. Fully additive — no existing row breaks.

```sql
ALTER TABLE companies ADD COLUMN IF NOT EXISTS industry VARCHAR(80);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS location VARCHAR(120);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS recruiter_spoc VARCHAR(150);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS expected_package_lpa NUMERIC(6,2);
```

**Left for you:** backfill these for existing companies as you get the info; new companies added through the form populate them going forward.

**Status:** the Add/Edit company form and the Companies table are already built to read/write these via `$queryRaw` and will show real data the moment the columns exist — no further code changes needed.

---

## 2. Mode, backlogs allowed, eligible departments, round labels (Placement Drives)

**Why**
- Reference design's Placement Drives list has a Mode column (On campus/Virtual) and filter; the drive detail page's Criteria card has "Backlogs allowed" and "Departments"; the Selection process card has named rounds (e.g. "Online assessment", "Technical interview", "HR interview") and a result-declaration note.
- `placement_drives` has `eligibility_cgpa` (real, already used) but nothing for mode, backlogs, eligible departments, or per-round labels.

**What it does**
- Adds 6 nullable columns to the existing `placement_drives` table. Fully additive — no existing row breaks.

```sql
ALTER TABLE placement_drives ADD COLUMN IF NOT EXISTS mode VARCHAR(20);
ALTER TABLE placement_drives ADD COLUMN IF NOT EXISTS backlogs_allowed VARCHAR(50);
ALTER TABLE placement_drives ADD COLUMN IF NOT EXISTS eligible_department_codes VARCHAR(200);
ALTER TABLE placement_drives ADD COLUMN IF NOT EXISTS round1_label VARCHAR(100);
ALTER TABLE placement_drives ADD COLUMN IF NOT EXISTS round2_label VARCHAR(100);
ALTER TABLE placement_drives ADD COLUMN IF NOT EXISTS round3_label VARCHAR(100);
ALTER TABLE placement_drives ADD COLUMN IF NOT EXISTS result_declaration_note VARCHAR(200);
```

**Left for you:** backfill these for existing drives as you get the info (`mode` as `'on_campus'` or `'virtual'`, `eligible_department_codes` as a comma-separated list like `CSE,IT,AIDS`); new/edited drives populate them going forward.

**Status:** the Placement Drives list, drive detail page and the drive form are already built to read/write these via `$queryRaw` and will show real data the moment the columns exist — no further code changes needed.

**Status:** the Finance & fees page is already built to read both via `$queryRaw` and will show real data the moment it exists — no further code changes needed. Until then, collection/outstanding-dues/fee-head-breakdown/collection-by-year tiles are real (from `student_fee_demand_mapping`/`fee_payments`), "Salaries and benefits" expenditure is real (from `salary_payments`), and scholarships/budget/other expenditure heads are honestly shown as not tracked. "Outstanding dues by age" ACTION column (Reminder SMS sent / Mentor follow-up / etc.) is not proposed here — it's not a data gap but a whole notification/escalation workflow this system has never implemented anywhere (confirmed: `hall-ticket-clearance.service.ts` explicitly documents fee-due gating as "still an unimplemented stub"); it's shown as a static label, not a live field, and isn't something a single migration would make real.

---

## 3. Interview scheduling (Placement's Interviews page)

**Why**
- Reference design's Interviews page schedules a student+company+round into a panel/slot, tracks a scheduled/in-progress/completed status, and records a result (which folds back into the student's real application progress) plus panel feedback.
- Nothing interview-shaped exists anywhere in the schema — no panel, slot, or round-name concept at all (only `student_drive_applications.status`/`last_cleared_round`, which track overall progress, not individual scheduled sessions).

**What it does**
- Adds one new table. Every interview links to a real student and a real drive (not a duplicate of `student_drive_applications` — "Result" is read from/written to that existing table, not stored twice). `interview_date` is a real date column (not part of the reference's own free-text "Slot" field) so the "Scheduled today"/"Upcoming" tiles can be computed exactly instead of string-matching the slot text like the reference demo does.

```sql
CREATE TABLE IF NOT EXISTS placement_interviews (
  id SERIAL PRIMARY KEY,
  student_id INTEGER NOT NULL REFERENCES students(id),
  drive_id INTEGER NOT NULL REFERENCES placement_drives(id),
  interview_date DATE NOT NULL,
  round_label VARCHAR(100) NOT NULL,
  slot_label VARCHAR(100) NOT NULL,
  panel_member VARCHAR(150) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'scheduled',
  panel_feedback VARCHAR(500),
  created_by_user_id INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_placement_interviews_student ON placement_interviews(student_id);
CREATE INDEX IF NOT EXISTS idx_placement_interviews_drive ON placement_interviews(drive_id);
```

**Left for you:** nothing to backfill — this only affects interviews scheduled from now on.

**Status:** until this table exists, the Interviews page loads but is honestly empty (scheduling/recording a result surfaces a clear "not enabled yet" error instead of silently failing) — no further code changes needed once it's run.

---

## 4. Joining date and work location (Offers/Placements pages)

**Why**
- Reference design's Placements table has Joining and Location columns for each accepted offer.
- `student_drive_applications` already tracks `offered_package` per accepted offer, but nothing for when the student joins or where.

**What it does**
- Adds 2 nullable columns to the existing `student_drive_applications` table. Fully additive — no existing row breaks.

```sql
ALTER TABLE student_drive_applications ADD COLUMN IF NOT EXISTS joining_date DATE;
ALTER TABLE student_drive_applications ADD COLUMN IF NOT EXISTS work_location VARCHAR(120);
```

**Left for you:** backfill these for already-accepted offers as you get the info; the "Update offer status" modal now also captures both going forward.

**Status:** the Offers and Placements pages are already built to read/write these via `$queryRaw` and will show real data the moment the columns exist — no further code changes needed.

---

## 5. Placement eligibility + opt-out flags (Students page)

**Why**
- Students page has "Eligible this cycle" and "Opted out" tiles, both honestly showing "—" today.
- **Eligible this cycle** would naturally come from CGPA + no standing arrears — but this schema genuinely cannot compute either: `exam_marks.max_marks` is inconsistently 50 or 100 across real rows, so internal/external marks can't be recombined into a pass/fail per subject, and `exam_pass_rules_settings` assumes that split exists. This isn't a missing column, it's a data-quality gap in historical marks — no additive migration fixes it. (Confirmed via the same investigation that already excludes CGPA/backlogs from the Principal module's Students/Exams pages.)
- **Opted out** has zero backing anywhere — `user_status_enum` is only `active`/`inactive` (account status, unrelated to placement participation), and no consent/opt-out table exists.
- Since neither can be honestly *computed*, the only honest path is to let the Placement Officer *record* both directly — same pattern as a mentor recording an assessment, not a system inferring one.

**What it does**
- Adds 2 nullable/additive columns to `students`. No existing row breaks — every student reads as "not yet assessed" / "not opted out" until an officer sets it.

```sql
ALTER TABLE students ADD COLUMN IF NOT EXISTS placement_eligible BOOLEAN;
ALTER TABLE students ADD COLUMN IF NOT EXISTS placement_opted_out BOOLEAN NOT NULL DEFAULT false;
```

**Left for you:** nothing to backfill — `placement_eligible` starts NULL (shown as "—") and `placement_opted_out` starts `false` for every student; the Placement Officer sets both per student going forward from the Students page.

**Status:** not yet built — say the word and this gets wired the same way as #13/#14 (`$queryRaw` read/write, feature activates the moment these columns exist) once you've run it, or up front if you'd rather the code land before the SQL.
