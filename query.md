# Database change requests

- Titled sections, newest at the bottom.
- Nothing here has been run by Claude — admin reviews and runs it.
- Every statement is safe to re-run (`IF NOT EXISTS` / duplicate-safe).

---

## 1. Classroom/Lab utilisation tracking (Principal dashboard)

**Why**
- Dashboard needs "84% — 186 of 222 classrooms in use" style numbers.
- `classes` → no room field. `timetable_slots` (68 real rows) → no room field.
- `venues` exists with a real `capacity` column, but its 4 real rows are all exam/event spaces, not classrooms/labs, and nothing links it to the timetable.

**What it does**
- Adds a `venue_type` classifier to the existing `venues` table (reused, not duplicated).
- Adds a nullable `venue_id` on `timetable_slots`, linking each period to a room.
- Fully additive/nullable — no existing row breaks.

```sql
-- 1. New enum, safe to re-run
DO $$ BEGIN
  CREATE TYPE venue_type_enum AS ENUM ('classroom', 'lab', 'seminar_hall', 'auditorium', 'exam_hall', 'other');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- 2. Classify venues
ALTER TABLE venues ADD COLUMN IF NOT EXISTS venue_type venue_type_enum;

-- 3. Backfill the 4 real venues (matched by id, verified live):
--    id 1/2 = Examination Hall 1/2, id 3 = Seminar Hall, id 4 = Main Auditorium
UPDATE venues SET venue_type = 'exam_hall'    WHERE id IN (1, 2);
UPDATE venues SET venue_type = 'seminar_hall' WHERE id = 3;
UPDATE venues SET venue_type = 'auditorium'   WHERE id = 4;

-- 4. Link timetable periods to rooms
ALTER TABLE timetable_slots ADD COLUMN IF NOT EXISTS venue_id INTEGER REFERENCES venues(id);
CREATE INDEX IF NOT EXISTS idx_timetable_slots_venue ON timetable_slots(venue_id);
```

**Left for you (need real info Claude doesn't have):**

1. Add real classrooms/labs — none exist yet:
   ```sql
   -- INSERT INTO venues (name, location, capacity, venue_type) VALUES
   --   ('Room 101', 'Block C, First Floor', 60, 'classroom'),
   --   ('Physics Lab', 'Block C, Ground Floor', 30, 'lab');
   ```
2. Assign real rooms to the 68 existing `timetable_slots` rows — data entry, better via an admin screen than 68 manual `UPDATE`s.

**After both are done:** tell Claude — dashboard tiles get wired to real occupancy, and `prisma/schema.prisma` gets updated to match (not touched until then).

---

## 2. Announcement category (Reports/Announcements composer)

**Why**
- Reference design's "New announcement" composer has a Category dropdown (Academic/Department/Emergency/Event/General).
- `announcements` has no category-like column at all — only `target_audience` (parents/teachers/students/roles), which is a different concept (who sees it, not what kind it is).
- Built the dropdown UI already, but left it disabled rather than silently drop the selected value on submit.

**What it does**
- Adds a nullable `category` classifier to `announcements`. Nullable/additive — every existing row keeps working with `category = NULL`.

```sql
DO $$ BEGIN
  CREATE TYPE announcement_category_enum AS ENUM ('academic', 'department', 'emergency', 'event', 'general');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE announcements ADD COLUMN IF NOT EXISTS category announcement_category_enum;
```

**After this is done:** tell Claude — the composer's Category dropdown gets wired to actually save, and `prisma/schema.prisma` gets updated to match.

**Separately, not proposed here:** the composer's "Schedule for" field needs more than a column — a scheduled `published_at` alone does nothing without a background job to flip `status` from draft to published when it's due (this repo already has `@nestjs/schedule` installed, so the mechanism exists, just not wired for this). Left disabled in the UI rather than half-built. Say the word if you want that built — it's a real feature, not a one-line fix.

---

## 3. More `personal_calendar_entries` categories (Principal's private calendar)

**Why**
- Current enum only has `personal` / `reminder` / `meeting` — Principal asked for more categories on this composer.
- `personal_calendar_entries` is private (`user_id`-scoped), so this is safe to extend without touching the institution-wide `calendar_events` categories (`holiday` / `event`, untouched).

**What it does**
- Adds 4 more values to the existing enum. Purely additive — existing rows (`personal`/`reminder`/`meeting`) are untouched.

```sql
ALTER TYPE personal_calendar_entry_category_enum ADD VALUE IF NOT EXISTS 'task';
ALTER TYPE personal_calendar_entry_category_enum ADD VALUE IF NOT EXISTS 'deadline';
ALTER TYPE personal_calendar_entry_category_enum ADD VALUE IF NOT EXISTS 'follow_up';
ALTER TYPE personal_calendar_entry_category_enum ADD VALUE IF NOT EXISTS 'note';
```

**After this is done:** tell Claude — `prisma/schema.prisma`'s enum gets pulled to match, and the composer's Category dropdown gets the 4 new options (Task/Deadline/Follow-up/Note) alongside the existing Personal/Reminder/Meeting.

---

## 4. Scholarship + admission status on `student_higher_education` (Principal's Higher Education page)

**Why**
- Reference design's Higher Education page has a "Scholarship count" tile + SCHOLARSHIP column, and a "5 already hold a confirmed admission" stat.
- `student_higher_education` (7 columns: `id, student_id, preferred_course, preferred_country, preferred_university, remarks, created_at`) has neither — the only trace of "scholarship" anywhere is incidental free text inside 2 real rows' `remarks` (e.g. "Exploring DAAD scholarship options"), which isn't something to build a filterable UI feature on.
- Field names are literally `preferred_*` — there's no status distinguishing "interested in" from "confirmed admission" today.

**What it does**
- Adds 2 nullable/additive columns for scholarship info, plus a nullable admission-status enum. No existing row (2 real rows today) breaks — both new columns default to null/false.

```sql
ALTER TABLE student_higher_education ADD COLUMN IF NOT EXISTS is_scholarship BOOLEAN DEFAULT false;
ALTER TABLE student_higher_education ADD COLUMN IF NOT EXISTS scholarship_name VARCHAR(150);

DO $$ BEGIN
  CREATE TYPE higher_education_admission_status_enum AS ENUM ('interested', 'applied', 'admitted', 'enrolled');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
ALTER TABLE student_higher_education ADD COLUMN IF NOT EXISTS admission_status higher_education_admission_status_enum;
```

**Left for you (need real info Claude doesn't have):**

1. Backfill `is_scholarship`/`scholarship_name`/`admission_status` for the 2 existing rows (student_id 3 and 33) if you know their real current status — otherwise they'll just show "—"/"Not tracked" until set, same as any new row going forward.

**After this is done:** tell Claude — the Scholarship tile/column and the confirmed-admission stat get wired to real data, and `prisma/schema.prisma` gets updated to match. Until then, the Higher Education page shows real totals/countries only, with these two figures honestly left as "—"/omitted rather than guessed.

---

## 5. Registration type, incubation seating, role on `student_entrepreneurship` (Principal's EDC page)

**Why**
- Reference design's EDC page has a "Registered ventures" tile (private limited vs. LLP/proprietorship split), a "Startups inside college" tile (seated in the campus incubation centre), and a ROLE column.
- `student_entrepreneurship` (9 columns: `id, student_id, business_name, business_description, sector, stage, funding_required, remarks, created_at`) has none of these — only 1 real row exists today, and `stage`/`sector` are unconstrained free text.
- The table is one row per student (`student_id` is `@unique`) — a shared venture across co-founders would be multiple rows with the same `business_name`, so a lightweight per-row `role` column (not a full team table) fits the existing shape.

**What it does**
- Adds 3 nullable/additive columns. The 1 existing row is untouched (all null until set).

```sql
DO $$ BEGIN
  CREATE TYPE venture_registration_type_enum AS ENUM ('private_limited', 'llp', 'proprietorship', 'unregistered');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
ALTER TABLE student_entrepreneurship ADD COLUMN IF NOT EXISTS registration_type venture_registration_type_enum;

ALTER TABLE student_entrepreneurship ADD COLUMN IF NOT EXISTS is_incubated BOOLEAN DEFAULT false;
ALTER TABLE student_entrepreneurship ADD COLUMN IF NOT EXISTS role VARCHAR(50);
```

**Left for you (need real info Claude doesn't have):**

1. Backfill `registration_type`/`is_incubated`/`role` for the 1 existing row (student_id 2, "CampusEats") if you know its real status — otherwise it shows "—"/"Not tracked" until set.

**After this is done:** tell Claude — the Registered ventures/Startups-inside-college tiles and the ROLE column get wired to real data, and `prisma/schema.prisma` gets updated to match. Until then, the EDC page shows real students-in-EDC/startup-stage/sector/funding figures only, with registration type, incubation seating, and role honestly left as "—" rather than guessed.

---

## 6. Principal as a real 3rd approval stage on Leave + OD (Principal's Approvals page)

**Why**
- Reference design's "Approvals" page shows the Principal accepting/rejecting a wide mix of request types (SOP, POP, OD, LEAVE, PURCHASE, BUDGET, EVENT, MOU, RECRUITMENT, INFRASTRUCTURE, TRANSPORT, CIRCULAR, EXAM).
- Investigated every approval-shaped table in this schema: **none has a Principal-level stage today.** `faculty_leaves`/`faculty_od_requests` hard-stop at `hod_approval_status`/`hr_approval_status`; purchase/service indents stop at HOD→Finance→Admin; `secretary_service_requests`/`secretary_product_requests` (the real tables behind "SOP"/"POP") resolve at Admin; appraisals' `management_approved_by` is HR Payroll's own final step, not Principal. `budget_requests`, a dedicated SOP table, `circular`, `mou`, `recruitment_request`, `infrastructure_request` **don't exist anywhere in this schema** — the mockup's remaining categories have zero backing.
- You chose to make the Principal a genuine 3rd approval stage on the two real, high-volume workflows that fit — Leave and (faculty) OD — rather than build a queue over categories that don't exist or aren't Principal's to approve.

**What it does**
- Adds an independent `principal_approval_status` column to both tables, mirroring the existing `hod_approval_status`/`hr_approval_status` shape exactly (same `approval_status_enum`, same `_decided_by_user_id`/`_decided_at`/`_remarks` naming). It's independent, not sequenced after HOD/HR at the database level — same as HOD and HR are independent of each other today.

```sql
ALTER TABLE faculty_leaves ADD COLUMN IF NOT EXISTS principal_approval_status approval_status_enum DEFAULT 'pending';
ALTER TABLE faculty_leaves ADD COLUMN IF NOT EXISTS principal_decided_by_user_id INTEGER REFERENCES users(id);
ALTER TABLE faculty_leaves ADD COLUMN IF NOT EXISTS principal_decided_at TIMESTAMPTZ;
ALTER TABLE faculty_leaves ADD COLUMN IF NOT EXISTS principal_remarks VARCHAR(255);

ALTER TABLE faculty_od_requests ADD COLUMN IF NOT EXISTS principal_approval_status approval_status_enum DEFAULT 'pending';
ALTER TABLE faculty_od_requests ADD COLUMN IF NOT EXISTS principal_decided_by_user_id INTEGER REFERENCES users(id);
ALTER TABLE faculty_od_requests ADD COLUMN IF NOT EXISTS principal_decided_at TIMESTAMPTZ;
ALTER TABLE faculty_od_requests ADD COLUMN IF NOT EXISTS principal_remarks VARCHAR(255);
```

**Heads up — real consequence, not a side effect to overlook:**
- `DEFAULT 'pending'` means every existing row (18 real `faculty_leaves`, 9 real `faculty_od_requests` — including ones already fully approved by HOD+HR months ago) will immediately show up as "pending Principal approval" the moment this runs. That's ~27 historical requests in the Principal's queue on day one, not just new ones going forward. If you'd rather start clean, tell Claude before running this — an `UPDATE ... SET principal_approval_status = 'approved'` backfill for already-HOD+HR-approved rows can be added here first.

**Status:** the Approvals page (Pending/Accepted/Rejected/average-close-time tiles + Accept/Reject queue, scoped to Leave and OD only) is already built end-to-end against these exact column names, using `$queryRaw`/`$executeRaw` so it works the moment this SQL runs — no further code changes needed on Claude's side. **After you run this:** tell Claude to live-test it and pull `prisma/schema.prisma` to match (so future work can use the typed Prisma client instead of raw SQL for these columns).

---

## 7. Hostel room-type fee structure (Principal's Hostel page)

**Why**
- Reference design has a "Fee structure by room type" table (ROOM RENT, MESS, CAUTION DEPOSIT, TOTAL PER YEAR) with subtitle "Annual figures for AY 2026-27 · caution deposit refundable on vacating".
- No such table exists: `hostel_rooms.room_type_id` → `hostel_room_types` is just a free-text name label ("A - Four Sharing", "A - Three Sharing"); the only real hostel fee data is 2 generic lump-sum rows in `fee_structures` (`applies_to = 'hostel'`), never broken into rent/mess/deposit and never keyed by room type at all.

**What it does**
- Adds one new table, one row per room type, admin-editable. Not year-versioned (no history) — deliberately simple: the admin updates the same row when rates change, rather than this needing per-year academic_year-format handling like other tables in this schema already suffer from.

```sql
CREATE TABLE IF NOT EXISTS hostel_room_type_fees (
  id SERIAL PRIMARY KEY,
  room_type_id INTEGER NOT NULL UNIQUE REFERENCES hostel_room_types(id),
  academic_year VARCHAR(20) NOT NULL,
  room_rent NUMERIC(10,2) NOT NULL DEFAULT 0,
  mess_fee NUMERIC(10,2) NOT NULL DEFAULT 0,
  caution_deposit NUMERIC(10,2) NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**Left for you (need real info Claude doesn't have):**

1. Insert one row per real room type (`"A -Four Sharing"` id 1, `"A - Three Sharing"` id 2, and any others) with real rent/mess/deposit figures, e.g.:
   ```sql
   -- INSERT INTO hostel_room_type_fees (room_type_id, academic_year, room_rent, mess_fee, caution_deposit) VALUES
   --   (1, '2026-27', 45000, 30000, 10000),
   --   (2, '2026-27', 55000, 30000, 10000);
   ```

**Status:** the Hostel page is already built to read this table via `$queryRaw` and will pick up real rows the moment this table exists and has data — no further code changes needed. Until then it shows every real room type with "—" for each fee column.

---

## 8. Night curfew / roll-call time (Principal's Hostel page)

**Why**
- Reference design's header says "night roll call closes at 9.30 pm" — grepped the whole schema and codebase for `curfew`/`roll_call`/`night_roll_call`/`gate_close`: zero matches anywhere, including the existing `hostel_settings` singleton table. There is no real 9:30pm (or any) value to show — that string in the mockup is illustrative, not configured data.

**What it does**
- Adds one nullable column to the existing `hostel_settings` singleton row.

```sql
ALTER TABLE hostel_settings ADD COLUMN IF NOT EXISTS curfew_time TIME;
```

**Left for you:**

1. Set the real value once you know it, e.g. `UPDATE hostel_settings SET curfew_time = '21:30:00';` (there's only ever one row — `HostelSettingsService.getOrCreateRow()` lazily creates it if missing).

**Status:** the Hostel page reads this via `$queryRaw` and will show the real time the moment it's set — no further code changes needed. Until then, the header omits the roll-call line entirely rather than showing a placeholder time.

---

## 9. ~~Bus capacity, driver phone, departure time, per-bus ridership~~ — RESOLVED, no action needed

**Update:** this section originally proposed adding `capacity`/`driver_phone`/`departure_time` to `buses` and `bus_id` to `student_transport_mapping`. Running `npx prisma db pull` while building the Transport page turned up **significant drift between `prisma/schema.prisma` and the live database** — the real `buses` table already had `capacity`, `driver_phone`, `status`, and ~25 other columns (registration/service/insurance detail), and `student_transport_mapping` already had `bus_id`, none of which were reflected in the schema file this session had been reading. `transport_routes` also already has `departure_time`/`arrival_time`/`distance_km`/`boarding_area`, and `transport_stages` has `pickup_time`.

**No SQL needed for any of this — it already exists in production.** `prisma/schema.prisma` has been re-synced (`db pull` + `generate`) to match; the Transport module was rewritten to use the normal typed Prisma client instead of the `$queryRaw` workaround originally built around the presumed gap. If any of these real columns are simply unpopulated (null) for a given bus/route today, that's a data-entry gap, not a schema one — fill them in whenever convenient and the Transport page will reflect it immediately, no code or migration needed.

---

## 10. Medical equipment register (Principal's Campus & facilities → Medical centre)

**Why**
- Reference design has an "Equipment" tile and "Equipment register" table (EQUIPMENT, QTY, LOCATION, CONDITION) for the medical centre.
- No equipment/inventory table exists for the medical centre anywhere in the schema — `medical_visits`/`medical_staff` are real and fully used for the rest of the page, but there's nothing else.

**What it does**
- Adds one new table, one row per equipment type.

```sql
CREATE TABLE IF NOT EXISTS medical_equipment (
  id SERIAL PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  location VARCHAR(150),
  condition VARCHAR(30) NOT NULL DEFAULT 'working',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**Left for you:** insert real equipment rows once this exists, e.g. `INSERT INTO medical_equipment (name, quantity, location, condition) VALUES ('BP monitor', 2, 'Sick room', 'working');`

**Status:** the Medical centre page is already built to read this via `$queryRaw` and will show real rows the moment they exist — no further code changes needed. Until then it shows the real "Students treated"/"Medical faculty & staff" tiles and "Medical team"/"Recent treatment log" (all genuinely backed by `medical_visits`/`medical_staff`), with the Equipment tile and register honestly empty.

---

## 11. Sports faculty contact + sports achievements (Principal's Campus & facilities → Sports)

**Why**
- Reference design's Sports page has a "Sports faculty" roster (name, role, phone) and an "Achievements this semester" list (event, participant/team, result badge).
- `sports_teams.coach_name` is a bare free-text string — no phone, no role, no dedicated faculty table (unlike `hostel_wardens`/`medical_staff`, which are real standalone staff tables). No achievements table exists at all — the only achievements model (`department_achievements`) is department-scoped with no participant/result/discipline field, and mixes in non-sport awards.

**What it does**
- Adds a `phone` and `role` column to the existing `sports_teams` table (keeps the existing one-coach-per-team shape rather than inventing a separate roster table this data doesn't support yet), and a new `sports_achievements` table for real results.

```sql
ALTER TABLE sports_teams ADD COLUMN IF NOT EXISTS coach_phone VARCHAR(20);
ALTER TABLE sports_teams ADD COLUMN IF NOT EXISTS coach_role VARCHAR(100);

CREATE TABLE IF NOT EXISTS sports_achievements (
  id SERIAL PRIMARY KEY,
  team_id INTEGER REFERENCES sports_teams(id),
  event_name VARCHAR(255) NOT NULL,
  participant_name VARCHAR(255),
  result VARCHAR(50) NOT NULL,
  achievement_date DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**Left for you:** backfill `coach_phone`/`coach_role` on real `sports_teams` rows, and insert real results into `sports_achievements` as they happen.

**Status:** the Sports page is already built to read both via `$queryRaw` and will show real data the moment it exists — no further code changes needed. Until then, "Sports students" (via `student_sports_team_mapping`) and "Sports equipment" (via `sports_equipment`) tiles are real; coach phone/role and the achievements list are honestly empty/"—".

---

## 12. Scholarship schemes + budget allocations (Principal's Finance & fees)

**Why**
- Reference design has a "Scholarships" tile + "Scholarship and concession schemes" table (scheme name, beneficiaries, value, status), and a "Budget utilised" tile + "Expenditure against budget" table (head, sanctioned, spent, % share).
- Nothing scheme-shaped exists: `fee_concessions` is structure-scoped (not student-scoped, no scheme name/beneficiary count/status). No `budget`/`budget_allocations`/sanctioned-amount table exists anywhere — only `salary_payments` (real) can back "Salaries and benefits" spend; there's nothing to classify other spend (infrastructure/lab equipment/research) or to compare any of it against a sanctioned figure.

**What it does**
- Adds 2 new tables.

```sql
CREATE TABLE IF NOT EXISTS scholarship_schemes (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  academic_year VARCHAR(20) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'approved',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS student_scholarship_awards (
  id SERIAL PRIMARY KEY,
  scheme_id INTEGER NOT NULL REFERENCES scholarship_schemes(id),
  student_id INTEGER NOT NULL REFERENCES students(id),
  amount NUMERIC(12,2) NOT NULL,
  awarded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(scheme_id, student_id)
);

CREATE TABLE IF NOT EXISTS budget_allocations (
  id SERIAL PRIMARY KEY,
  head VARCHAR(150) NOT NULL,
  academic_year VARCHAR(20) NOT NULL,
  sanctioned_amount NUMERIC(14,2) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(head, academic_year)
);
```

**Left for you:** insert real scheme rows + per-student awards, and real sanctioned amounts per head, per academic year.

**Status:** the Finance & fees page is already built to read both via `$queryRaw` and will show real data the moment it exists — no further code changes needed. Until then, collection/outstanding-dues/fee-head-breakdown/collection-by-year tiles are real (from `student_fee_demand_mapping`/`fee_payments`), "Salaries and benefits" expenditure is real (from `salary_payments`), and scholarships/budget/other expenditure heads are honestly shown as not tracked. "Outstanding dues by age" ACTION column (Reminder SMS sent / Mentor follow-up / etc.) is not proposed here — it's not a data gap but a whole notification/escalation workflow this system has never implemented anywhere (confirmed: `hall-ticket-clearance.service.ts` explicitly documents fee-due gating as "still an unimplemented stub"); it's shown as a static label, not a live field, and isn't something a single migration would make real.
