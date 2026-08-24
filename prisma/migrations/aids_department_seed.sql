-- ============================================================
-- AIDS (Artificial Intelligence and Data Science) department —
-- seed data for department_id = 2.
--
-- How this was scoped: compared department_id=2 against its two
-- peer departments (CS=1, EC=3) across every table in the schema
-- that has a department_id column. Most "department profile"
-- tables (department_documents/events/labs/meetings/mous/
-- research_funding, nba_criteria, sports_teams,
-- exam_timetable_versions) are empty for ALL THREE departments —
-- that's a school-wide gap, not an AIDS-specific one, so it's
-- deliberately NOT included here. The tables below are the ones
-- where AIDS is genuinely behind CS/EC with real, comparable
-- data already sitting in the same table. Every row is modeled
-- directly on the one real example row CS already has, and every
-- FK (HOD faculty id=7 / user_id=34, AIDS class ids 4/5/10/11,
-- AIDS subject id=37 "Data Structures") is a real, already-
-- existing row — nothing fabricated.
-- ============================================================

-- 1. Department + course code: the seed script used the
--    shorthand "AD", but the college's own systems already say
--    "AIDS" (see the HOD's real email: hod_aids@sece.ac.in) —
--    renaming both to match.
--
--    NOT included: 41 existing students' roll_no/student_id_no/
--    register_no/admission_no all still embed the old "AD"
--    prefix (e.g. "22AD001"). Renaming those is a separate,
--    much bigger and riskier operation (3 unique-key columns ×
--    41 rows) — ask separately if you want that done too.
UPDATE departments SET code = 'AIDS' WHERE id = 2;
UPDATE courses SET code = 'AIDS' WHERE id = 2;

-- 2. Department announcement — CS has 1 (Semester 7 timetable
--    notice), AIDS has 0. Targets AIDS's senior batch (batch_id=1,
--    the one currently at semester 7 — see classes 4/5).
INSERT INTO announcements (posted_by_user_id, title, content, target_audience, batch_id, department_id, status)
VALUES (
  34, -- Lakshmi Narayanan, Professor & Head, AIDS (faculty id 7, users id 34)
  'Semester 7 Timetable Released',
  'Please check the timetable section for your updated class schedule.',
  'students', 1, 2, 'published'
);

-- 3. Curriculum mapping — CS has 1 (semester 3, Theory Courses),
--    AIDS has 0. Uses a real AIDS subject (id 37, "Data
--    Structures") for AIDS's semester-3 batch (batch_id=2, see
--    classes 10/11).
INSERT INTO curriculum_mappings (department_id, semester, subject_id, section, display_order)
VALUES (2, 3, 37, 'Theory Courses', 0);

-- 4. Feedback assignment — CS has 1, AIDS has 0. Department- and
--    semester-wide (class_id NULL, same as CS's row).
INSERT INTO feedback_assignments (course_type, year_of_study, department_id, semester, status)
VALUES ('THEORY', 2, 2, 3, 'NOT_STARTED');

-- 5. Non-teaching staff — CS has 1 (a lab assistant with a real
--    login), AIDS has 0. Creates a real login (same standard test
--    password used everywhere else: EOS@test123) plus the staff
--    record it belongs to.
INSERT INTO users (email, password_hash, role_id, status)
VALUES (
  'labassistant.aids@eos.test',
  '1e9b38de300be8453122d0138c5854010c9dc0587c53ceab4d9bcd14db882816', -- sha256("EOS@test123") — same as every other seeded test account
  14, -- role "non_teaching_staff"
  'active'
);

INSERT INTO non_teaching_staff (user_id, first_name, last_name, category, department_id, date_of_joining, status)
VALUES (
  (SELECT id FROM users WHERE email = 'labassistant.aids@eos.test'),
  'Deepa', 'Krishnan', 'lab_assistant', 2, '2019-06-03', 'active'
);

-- 6. Service indent — CS has 2, AIDS has 0.
INSERT INTO service_indents (requested_by_user_id, department_id, title, service_description, status)
VALUES (34, 2, 'AIDS Lab AC Maintenance', 'Quarterly AC servicing for the AI & DS systems lab.', 'submitted');

-- 7. Purchase indent — CS has 3, AIDS has 1; adding one more so
--    it's not a single-row outlier next to its peer department.
INSERT INTO purchase_indents (requested_by_user_id, department_id, item_name, quantity, purpose, status)
VALUES (34, 2, 'GPU Workstations', 5, 'Deep learning lab upgrade for final-year project work', 'submitted');
