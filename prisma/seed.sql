-- ============================================================================
--  EOS Backend — Full Database Seed
-- ============================================================================
--  Wipes every table and reloads a small, internally-consistent dataset that
--  covers every enum value at least once and follows the seeding rules given
--  by the team:
--
--   1. Erases all existing data before reloading (TRUNCATE ... CASCADE)
--   2. Keeps volumes small/limited in every table
--   3. A class has at most 5 subjects per semester
--   4. A faculty member teaches across at most 6 classes, spanning different
--      batches
--   5. Each (batch, department) pair has at most 3 classes/sections
--   6. Each faculty member is the *mentor* of exactly one class
--   7. Faculty only teach/mentor classes inside their own department
--   8. Every class has exactly 10 students
--   9. All 27 roles from the supplied role list are seeded, each with a demo
--      login user
--  10. Each hostel block has 4 floors x 15 rooms, capacity 4/room
--  11. Room numbers follow "<Block>-<FloorLetter><1-15>" e.g. "A-G1", "A-F15"
--  12. Student email:  <firstname>.<lastinitial><batchYear><deptSlug>@sece.ac.in
--                      e.g. raja.k2022aids@sece.ac.in
--  13. Faculty email:  <firstname>.<lastinitial>@sece.ac.in
--  14. HOD email:      hod_<deptSlug>@sece.ac.in
--  15. Roll no:        <batchYY><DEPTCODE><serial>, serial continues across
--                      sections in blocks of 10 (Sec A 001-010, B 011-020, ...)
--  16. Every semester has 2 internal exams + 1 university exam; every
--      student has marks entered for all 3 exams for every semester they
--      have completed, up to semester 6
--  17. Course/subject codes use department shortforms (AD = AI & Data
--      Science, CS = Computer Science, EC = Electronics & Communication)
--
--  Login password for every seeded user: EOS@test123
--  (sha256 hex digest, matches prisma/seed.ts convention)
-- ============================================================================

BEGIN;

TRUNCATE TABLE
  "academic_calendars", "achievement_comments", "achievement_media", "alumni_announcements", "alumni_batches", "alumni_group_messages", "alumni_members", "announcement_class_mapping", "announcement_role_mapping", "announcements", "appraisal_attachments", "appraisal_criteria", "appraisal_divisions", "appraisal_entries", "appraisal_requests", "assignments", "attendance_records", "batches", "bills", "bonafide_reasons", "bonafide_requests", "book_borrow_records", "book_categories", "books", "bus_live_locations", "buses", "calendar_events", "certificate_types", "class_mentors", "class_subjects", "classes", "coe_profiles", "companies", "courses", "demand_categories", "department_achievements", "departments", "e_resources", "education_loan_dd", "exam_marks", "exam_pass_rules_settings", "exam_subject_mapping", "exam_timetable", "exam_timetable_versions", "exam_types", "exams", "expense_categories", "expenses", "faculty", "faculty_activity_log", "faculty_daily_attendance", "faculty_documents", "faculty_holiday_mapping", "faculty_hostel_mapping", "faculty_id_card_issuances", "faculty_leaves", "faculty_od_requests", "faculty_sensitive_info", "faculty_subject_class_mapping", "fee_concessions", "fee_payments", "fee_structure_items", "fee_structures", "feedback_forms", "feedback_questions", "feedback_responses", "grade_bands", "grn", "hall_plans", "hall_ticket_clearance_exceptions", "hall_tickets", "holiday_slots", "hostel_blocks", "hostel_complaints", "hostel_goods", "hostel_in_out_ledger", "hostel_mess_feedback", "hostel_outings", "hostel_quit_requests", "hostel_room_types", "hostel_rooms", "hostel_settings", "hostel_wardens", "hostels", "invigilation_allocation_batches", "invigilation_duties", "lesson_plans", "library_racks", "library_settings", "lms_notes", "main_gate_in_out_ledger", "malpractice_incidents", "marks_entry_locks", "marksheets", "media_requests", "non_teaching_staff", "notifications", "od_request_hod_approvals", "od_requests", "od_team_members", "od_teams", "parent_student_mapping", "payslip_requests", "photocopy_requests", "placement_drives", "project_join_requests", "project_recruitment_posts", "project_team_members", "project_teams", "purchase_indents", "purchase_order_proposals", "purchase_orders", "quotas", "result_publications", "revaluation_requests", "revaluation_windows", "roles", "salary_divisions", "salary_payments", "seating_arrangements", "seating_plan_venue_departments", "seating_plan_version_venues", "seating_plan_versions", "secretary_product_request_items", "secretary_product_requests", "secretary_service_request_items", "secretary_service_requests", "service_indents", "service_order_proposals", "service_orders", "soa_applications", "student_addresses", "student_assignment_status", "student_certificates", "student_contacts", "student_drive_applications", "student_family_details", "student_fee_demand_mapping", "student_hostel_mapping", "student_identity_marks", "student_leaves", "student_profiles", "student_projects", "student_sensitive_info", "student_transport_mapping", "students", "subjects", "timetable_slots", "transport_routes", "transport_stages", "users", "vendor_quotations", "vendors", "venue_bookings", "venues", "visitor_logs", "wallet_outlets", "wallet_transactions", "wallets", "personal_calendar_entries", "student_entrepreneurship", "student_higher_education", "user_social_links"
RESTART IDENTITY CASCADE;

-- A single constant used everywhere below. Plaintext password: EOS@test123
-- (sha256 hex digest — matches the convention already used by prisma/seed.ts)
-- \set pwhash '1e9b38de300be8453122d0138c5854010c9dc0587c53ceab4d9bcd14db882816'

-- ============================================================================
-- 1. ROLES  (exact list supplied by the team — 26 roles)
-- ============================================================================
INSERT INTO roles (id, name, description) OVERRIDING SYSTEM VALUE VALUES
  (1,  'admin',                'System Administrator – full access'),
  (2,  'management',           'Institution management / trustee'),
  (3,  'principal',            'College Principal'),
  (4,  'hod',                  'Head of Department'),
  (5,  'faculty',              'Teaching Faculty'),
  (6,  'student',               'Student'),
  (7,  'parent',                'Parent / Guardian'),
  (8,  'librarian',             'Library staff'),
  (9,  'warden',                'Hostel warden'),
  (10, 'accountant',            'Finance / accounts staff'),
  (11, 'placement_officer',     'Placement cell officer'),
  (12, 'transport_manager',     'Transport department staff'),
  (13, 'security',              'Security / gate staff'),
  (14, 'non_teaching_staff',    'Non-teaching support staff'),
  (15, 'alumni_coordinator',    'Alumni relations coordinator'),
  (21, 'coe',                   'Controller of Examinations'),
  (22, 'placement',             'Placement Cell'),
  (23, 'library',               'Library Staff'),
  (24, 'billing',               'Billing / Fees Collection'),
  (25, 'hr_payroll',            'HR & Payroll Management'),
  (26, 'finance',               'Finance Team'),
  (27, 'iqac',                  'IQAC – Internal Quality Assurance Cell'),
  (28, 'secretary',             'Department Secretary / IT Infrastructure'),
  (29, 'gate_warden',           'Main Gate Watch / Hostel Warden'),
  (30, 'media_room',            'Media Room'),
  (31, 'academic_coordinator',  'Academic Co-ordinator'),
  (32, 'alumni',                'Alumni');

-- ============================================================================
-- 2. DEPARTMENTS / COURSES / BATCHES / CLASSES  (rules 5, 17)
-- ============================================================================
INSERT INTO departments (id, name, code) OVERRIDING SYSTEM VALUE VALUES
  (1, 'Computer Science and Engineering',            'CS'),
  (2, 'Artificial Intelligence and Data Science',    'AD'),
  (3, 'Electronics and Communication Engineering',   'EC');

INSERT INTO courses (id, name, code, department_id, duration_years) OVERRIDING SYSTEM VALUE VALUES
  (1, 'B.Tech Computer Science and Engineering',           'CS', 1, 4),
  (2, 'B.Tech Artificial Intelligence and Data Science',   'AD', 2, 4),
  (3, 'B.Tech Electronics and Communication Engineering',  'EC', 3, 4);

INSERT INTO batches (id, name, start_year, end_year) OVERRIDING SYSTEM VALUE VALUES
  (1, '2022_2026', 2022, 2026),
  (2, '2023_2027', 2023, 2027);

-- 13 classes total. CSE(batch 2022_2026) uses 3 sections to demonstrate the
-- "max 3 classes per batch+department" ceiling (rule 5); every other
-- batch+department pair uses 2 sections, comfortably under the cap.
-- current_semester: batch 2022_2026 is in its 7th semester (senior/final
-- year), batch 2023_2027 is in its 3rd semester (sophomore year).
INSERT INTO classes (id, batch_id, department_id, course_id, section, current_semester) OVERRIDING SYSTEM VALUE VALUES
  (1,  1, 1, 1, 'A', 7),
  (2,  1, 1, 1, 'B', 7),
  (3,  1, 1, 1, 'C', 7),
  (4,  1, 2, 2, 'A', 7),
  (5,  1, 2, 2, 'B', 7),
  (6,  1, 3, 3, 'A', 7),
  (7,  1, 3, 3, 'B', 7),
  (8,  2, 1, 1, 'A', 3),
  (9,  2, 1, 1, 'B', 3),
  (10, 2, 2, 2, 'A', 3),
  (11, 2, 2, 2, 'B', 3),
  (12, 2, 3, 3, 'A', 3),
  (13, 2, 3, 3, 'B', 3);

-- ============================================================================
-- 3. SUBJECTS  (rules 3, 16, 17 — 5 subjects x 6 semesters x 3 departments)
--    subject_code = <DEPTCODE><semester digit><2-digit sequence>, e.g. CS101
--    is semester 1, subject 1 of CSE. This lets every derived table below
--    recover "which semester does this subject belong to" with
--    substring(subject_code from 3 for 1), instead of hand-listing rows.
-- ============================================================================
INSERT INTO subjects (id, name, subject_code, department_id, credits) OVERRIDING SYSTEM VALUE VALUES
  -- CSE (department_id = 1) --------------------------------------------------
  (1,  'Mathematics I',                          'CS101', 1, 4),
  (2,  'Physics for Engineers',                  'CS102', 1, 3),
  (3,  'Programming in C',                       'CS103', 1, 4),
  (4,  'English for Engineers',                  'CS104', 1, 2),
  (5,  'Environmental Science',                  'CS105', 1, 2),
  (6,  'Mathematics II',                         'CS201', 1, 4),
  (7,  'Data Structures',                        'CS202', 1, 4),
  (8,  'Digital Logic Design',                   'CS203', 1, 3),
  (9,  'Object Oriented Programming',             'CS204', 1, 3),
  (10, 'Engineering Graphics',                   'CS205', 1, 2),
  (11, 'Discrete Mathematics',                   'CS301', 1, 3),
  (12, 'Computer Organization',                  'CS302', 1, 3),
  (13, 'Database Management Systems',            'CS303', 1, 4),
  (14, 'Operating Systems',                      'CS304', 1, 4),
  (15, 'Design and Analysis of Algorithms',      'CS305', 1, 3),
  (16, 'Theory of Computation',                  'CS401', 1, 3),
  (17, 'Software Engineering',                   'CS402', 1, 3),
  (18, 'Computer Networks',                      'CS403', 1, 4),
  (19, 'Java Programming',                       'CS404', 1, 3),
  (20, 'Probability and Statistics',             'CS405', 1, 3),
  (21, 'Web Technologies',                       'CS501', 1, 3),
  (22, 'Machine Learning',                       'CS502', 1, 4),
  (23, 'Compiler Design',                        'CS503', 1, 3),
  (24, 'Cloud Computing',                        'CS504', 1, 3),
  (25, 'Cyber Security',                         'CS505', 1, 3),
  (26, 'Artificial Intelligence',                'CS601', 1, 4),
  (27, 'Mobile Application Development',         'CS602', 1, 3),
  (28, 'Distributed Systems',                    'CS603', 1, 3),
  (29, 'Big Data Analytics',                     'CS604', 1, 3),
  (30, 'Elective - Blockchain Technology',       'CS605', 1, 2),
  -- AIDS (department_id = 2) -------------------------------------------------
  (31, 'Mathematics I',                          'AD101', 2, 4),
  (32, 'Physics for Engineers',                  'AD102', 2, 3),
  (33, 'Programming in Python',                  'AD103', 2, 4),
  (34, 'English for Engineers',                  'AD104', 2, 2),
  (35, 'Environmental Science',                  'AD105', 2, 2),
  (36, 'Mathematics II',                         'AD201', 2, 4),
  (37, 'Data Structures',                        'AD202', 2, 4),
  (38, 'Digital Logic Design',                   'AD203', 2, 3),
  (39, 'Statistics for Data Science',            'AD204', 2, 3),
  (40, 'Engineering Graphics',                   'AD205', 2, 2),
  (41, 'Discrete Mathematics',                   'AD301', 2, 3),
  (42, 'Database Management Systems',            'AD302', 2, 4),
  (43, 'Operating Systems',                      'AD303', 2, 4),
  (44, 'Data Visualization',                     'AD304', 2, 3),
  (45, 'Design and Analysis of Algorithms',      'AD305', 2, 3),
  (46, 'Machine Learning Foundations',           'AD401', 2, 4),
  (47, 'Software Engineering',                   'AD402', 2, 3),
  (48, 'Computer Networks',                      'AD403', 2, 4),
  (49, 'Data Mining',                            'AD404', 2, 3),
  (50, 'Probability and Statistics',             'AD405', 2, 3),
  (51, 'Deep Learning',                          'AD501', 2, 4),
  (52, 'Big Data Analytics',                     'AD502', 2, 3),
  (53, 'Natural Language Processing',            'AD503', 2, 3),
  (54, 'Cloud Computing',                        'AD504', 2, 3),
  (55, 'Cyber Security',                         'AD505', 2, 3),
  (56, 'Computer Vision',                        'AD601', 2, 4),
  (57, 'Reinforcement Learning',                 'AD602', 2, 3),
  (58, 'Data Engineering',                       'AD603', 2, 3),
  (59, 'MLOps',                                  'AD604', 2, 3),
  (60, 'Elective - Blockchain Technology',       'AD605', 2, 2),
  -- ECE (department_id = 3) ---------------------------------------------------
  (61, 'Mathematics I',                          'EC101', 3, 4),
  (62, 'Physics for Engineers',                  'EC102', 3, 3),
  (63, 'Basic Electrical Engineering',           'EC103', 3, 4),
  (64, 'English for Engineers',                  'EC104', 3, 2),
  (65, 'Environmental Science',                  'EC105', 3, 2),
  (66, 'Mathematics II',                         'EC201', 3, 4),
  (67, 'Electronic Devices and Circuits',        'EC202', 3, 4),
  (68, 'Digital Logic Design',                   'EC203', 3, 3),
  (69, 'Engineering Graphics',                   'EC204', 3, 2),
  (70, 'Network Theory',                         'EC205', 3, 3),
  (71, 'Signals and Systems',                    'EC301', 3, 3),
  (72, 'Electromagnetic Fields',                 'EC302', 3, 3),
  (73, 'Analog Integrated Circuits',             'EC303', 3, 4),
  (74, 'Control Systems',                        'EC304', 3, 3),
  (75, 'Discrete Mathematics',                   'EC305', 3, 3),
  (76, 'Digital Signal Processing',              'EC401', 3, 4),
  (77, 'Communication Systems',                  'EC402', 3, 4),
  (78, 'Microprocessors and Microcontrollers',   'EC403', 3, 3),
  (79, 'Linear IC Applications',                 'EC404', 3, 3),
  (80, 'Probability and Statistics',             'EC405', 3, 3),
  (81, 'VLSI Design',                            'EC501', 3, 4),
  (82, 'Antenna and Wave Propagation',           'EC502', 3, 3),
  (83, 'Embedded Systems',                       'EC503', 3, 3),
  (84, 'Computer Networks',                      'EC504', 3, 3),
  (85, 'Cyber Security',                         'EC505', 3, 3),
  (86, 'Wireless Communication',                 'EC601', 3, 4),
  (87, 'Optical Communication',                  'EC602', 3, 3),
  (88, 'Elective - Internet of Things',          'EC603', 3, 2),
  (89, 'Digital Image Processing',               'EC604', 3, 3),
  (90, 'Elective - Blockchain Technology',       'EC605', 3, 2),
  -- Semester 7 (final year) — only batch 2022_2026 reaches this semester,
  -- and only project/professional-elective style subjects are offered here
  -- since marks history is intentionally only seeded up to semester 6
  -- (rule 16); this semester is still "in progress" (see exams section).
  (91,  'Project Work Phase I',                  'CS701', 1, 4),
  (92,  'Elective - Deep Learning',               'CS702', 1, 3),
  (93,  'Elective - DevOps',                       'CS703', 1, 3),
  (94,  'Professional Ethics',                    'CS704', 1, 2),
  (95,  'Elective - Quantum Computing',           'CS705', 1, 2),
  (96,  'Project Work Phase I',                   'AD701', 2, 4),
  (97,  'Elective - Generative AI',                'AD702', 2, 3),
  (98,  'Elective - Edge AI',                      'AD703', 2, 3),
  (99,  'Professional Ethics',                    'AD704', 2, 2),
  (100, 'Elective - Robotics',                    'AD705', 2, 2),
  (101, 'Project Work Phase I',                   'EC701', 3, 4),
  (102, 'Elective - 5G Communication',            'EC702', 3, 3),
  (103, 'Elective - Robotics',                    'EC703', 3, 3),
  (104, 'Professional Ethics',                    'EC704', 3, 2),
  (105, 'Elective - Quantum Computing',           'EC705', 3, 2);

-- Backfill the newer descriptive columns (short_code/category/course_type/
-- hours) from what's already on each row, so every subject_category_enum
-- and subject_course_type_enum value gets exercised.
UPDATE subjects SET
  short_code = subject_code,
  category = (CASE WHEN name ILIKE 'Elective%' THEN 'ELECTIVE'
                   WHEN name = 'Environmental Science' THEN 'MANDATORY'
                   WHEN name ILIKE '%Professional Ethics%' THEN 'VALUE_ADDED'
                   WHEN subject_code LIKE '%05' AND name NOT ILIKE 'Elective%' AND name NOT ILIKE '%Project%' THEN 'OPEN_ELECTIVE'
                   ELSE 'CORE' END)::subject_category_enum,
  course_type = (CASE WHEN name ILIKE '%Project%' THEN 'PROJECT'
                      WHEN name ILIKE '%Graphics%' OR name ILIKE '%Programming%' THEN 'THEORY_WITH_PRACTICAL'
                      WHEN name = 'Environmental Science' THEN 'AUDIT'
                      ELSE 'THEORY' END)::subject_course_type_enum,
  hours = credits;

-- ============================================================================
-- 4. CLASS <-> SUBJECT MAPPING  (rule 3: max 5 subjects/class/semester)
--    Set-based: every class picks up its department's subjects for every
--    semester it has already reached (1 through its current_semester).
--    Marks are only seeded up to semester 6 regardless (rule 16, see the
--    exams section) — semester 7 subjects exist so the one batch that gets
--    that far still has a real "in progress" current semester to test.
--    Each department has exactly 5 subjects per semester, so the 5-subject
--    cap (rule 3) is satisfied by construction.
-- ============================================================================
INSERT INTO class_subjects (class_id, subject_id, semester, is_elective)
SELECT
  c.id,
  s.id,
  substring(s.subject_code from 3 for 1)::smallint AS semester,
  (s.name ILIKE 'Elective%') AS is_elective
FROM classes c
JOIN subjects s ON s.department_id = c.department_id
WHERE substring(s.subject_code from 3 for 1)::smallint <= c.current_semester;

-- ============================================================================
-- 5. QUOTAS
-- ============================================================================
INSERT INTO quotas (id, name) OVERRIDING SYSTEM VALUE VALUES
  (1, 'Government Quota'),
  (2, 'Management Quota'),
  (3, 'NRI Quota'),
  (4, 'Sports Quota');

-- ============================================================================
-- 6. USERS — Part A: one generic quick-login user per role (rule 9)
--    Email convention: <role_name>@eos.test (mirrors prisma/seed.ts so the
--    existing Postman collection / docs that use these keep working).
--    Password for every single user created in this file: EOS@test123
-- ============================================================================
INSERT INTO users (id, email, password_hash, role_id, status) OVERRIDING SYSTEM VALUE VALUES
  (1,  'admin@eos.test',                '1e9b38de300be8453122d0138c5854010c9dc0587c53ceab4d9bcd14db882816', 1,  'active'),
  (2,  'management@eos.test',           '1e9b38de300be8453122d0138c5854010c9dc0587c53ceab4d9bcd14db882816', 2,  'active'),
  (3,  'principal@eos.test',            '1e9b38de300be8453122d0138c5854010c9dc0587c53ceab4d9bcd14db882816', 3,  'active'),
  (4,  'hod@eos.test',                  '1e9b38de300be8453122d0138c5854010c9dc0587c53ceab4d9bcd14db882816', 4,  'active'),
  (5,  'faculty@eos.test',              '1e9b38de300be8453122d0138c5854010c9dc0587c53ceab4d9bcd14db882816', 5,  'active'),
  (6,  'student@eos.test',              '1e9b38de300be8453122d0138c5854010c9dc0587c53ceab4d9bcd14db882816', 6,  'active'),
  (7,  'parent@eos.test',               '1e9b38de300be8453122d0138c5854010c9dc0587c53ceab4d9bcd14db882816', 7,  'active'),
  (8,  'librarian@eos.test',            '1e9b38de300be8453122d0138c5854010c9dc0587c53ceab4d9bcd14db882816', 8,  'active'),
  (9,  'warden@eos.test',               '1e9b38de300be8453122d0138c5854010c9dc0587c53ceab4d9bcd14db882816', 9,  'active'),
  (10, 'accountant@eos.test',           '1e9b38de300be8453122d0138c5854010c9dc0587c53ceab4d9bcd14db882816', 10, 'active'),
  (11, 'placement_officer@eos.test',    '1e9b38de300be8453122d0138c5854010c9dc0587c53ceab4d9bcd14db882816', 11, 'active'),
  (12, 'transport_manager@eos.test',    '1e9b38de300be8453122d0138c5854010c9dc0587c53ceab4d9bcd14db882816', 12, 'active'),
  (13, 'security@eos.test',             '1e9b38de300be8453122d0138c5854010c9dc0587c53ceab4d9bcd14db882816', 13, 'active'),
  (14, 'non_teaching_staff@eos.test',   '1e9b38de300be8453122d0138c5854010c9dc0587c53ceab4d9bcd14db882816', 14, 'active'),
  (15, 'alumni_coordinator@eos.test',   '1e9b38de300be8453122d0138c5854010c9dc0587c53ceab4d9bcd14db882816', 15, 'active'),
  (16, 'coe@eos.test',                  '1e9b38de300be8453122d0138c5854010c9dc0587c53ceab4d9bcd14db882816', 21, 'active'),
  (17, 'placement@eos.test',            '1e9b38de300be8453122d0138c5854010c9dc0587c53ceab4d9bcd14db882816', 22, 'active'),
  (18, 'library@eos.test',              '1e9b38de300be8453122d0138c5854010c9dc0587c53ceab4d9bcd14db882816', 23, 'active'),
  (19, 'billing@eos.test',              '1e9b38de300be8453122d0138c5854010c9dc0587c53ceab4d9bcd14db882816', 24, 'active'),
  (20, 'hr_payroll@eos.test',           '1e9b38de300be8453122d0138c5854010c9dc0587c53ceab4d9bcd14db882816', 25, 'active'),
  (21, 'finance@eos.test',              '1e9b38de300be8453122d0138c5854010c9dc0587c53ceab4d9bcd14db882816', 26, 'active'),
  (22, 'iqac@eos.test',                 '1e9b38de300be8453122d0138c5854010c9dc0587c53ceab4d9bcd14db882816', 27, 'active'),
  (23, 'secretary@eos.test',            '1e9b38de300be8453122d0138c5854010c9dc0587c53ceab4d9bcd14db882816', 28, 'active'),
  (24, 'gate_warden@eos.test',          '1e9b38de300be8453122d0138c5854010c9dc0587c53ceab4d9bcd14db882816', 29, 'active'),
  (25, 'media_room@eos.test',           '1e9b38de300be8453122d0138c5854010c9dc0587c53ceab4d9bcd14db882816', 30, 'active'),
  (26, 'academic_coordinator@eos.test', '1e9b38de300be8453122d0138c5854010c9dc0587c53ceab4d9bcd14db882816', 31, 'active'),
  (27, 'alumni@eos.test',               '1e9b38de300be8453122d0138c5854010c9dc0587c53ceab4d9bcd14db882816', 32, 'active');

-- ============================================================================
-- 6. USERS — Part B: 16 real faculty logins (rule 13/14 email convention)
--    3 HODs (hod_<deptSlug>@sece.ac.in) + 13 class mentors (one per class,
--    firstname.lastinitial@sece.ac.in).
-- ============================================================================
INSERT INTO users (id, email, password_hash, role_id, status) OVERRIDING SYSTEM VALUE VALUES
  (28, 'hod_cse@sece.ac.in',   '1e9b38de300be8453122d0138c5854010c9dc0587c53ceab4d9bcd14db882816', 4, 'active'),
  (29, 'arun.p@sece.ac.in',    '1e9b38de300be8453122d0138c5854010c9dc0587c53ceab4d9bcd14db882816', 5, 'active'),
  (30, 'divya.b@sece.ac.in',   '1e9b38de300be8453122d0138c5854010c9dc0587c53ceab4d9bcd14db882816', 5, 'active'),
  (31, 'karthik.r@sece.ac.in', '1e9b38de300be8453122d0138c5854010c9dc0587c53ceab4d9bcd14db882816', 5, 'active'),
  (32, 'priya.d@sece.ac.in',   '1e9b38de300be8453122d0138c5854010c9dc0587c53ceab4d9bcd14db882816', 5, 'active'),
  (33, 'manoj.k@sece.ac.in',   '1e9b38de300be8453122d0138c5854010c9dc0587c53ceab4d9bcd14db882816', 5, 'active'),
  (34, 'hod_aids@sece.ac.in',  '1e9b38de300be8453122d0138c5854010c9dc0587c53ceab4d9bcd14db882816', 4, 'active'),
  (35, 'anitha.s@sece.ac.in',  '1e9b38de300be8453122d0138c5854010c9dc0587c53ceab4d9bcd14db882816', 5, 'active'),
  (36, 'vignesh.w@sece.ac.in', '1e9b38de300be8453122d0138c5854010c9dc0587c53ceab4d9bcd14db882816', 5, 'active'),
  (37, 'kavya.s@sece.ac.in',   '1e9b38de300be8453122d0138c5854010c9dc0587c53ceab4d9bcd14db882816', 5, 'active'),
  (38, 'bala.m@sece.ac.in',    '1e9b38de300be8453122d0138c5854010c9dc0587c53ceab4d9bcd14db882816', 5, 'active'),
  (39, 'hod_ece@sece.ac.in',   '1e9b38de300be8453122d0138c5854010c9dc0587c53ceab4d9bcd14db882816', 4, 'active'),
  (40, 'deepa.r@sece.ac.in',   '1e9b38de300be8453122d0138c5854010c9dc0587c53ceab4d9bcd14db882816', 5, 'active'),
  (41, 'naveen.k@sece.ac.in',  '1e9b38de300be8453122d0138c5854010c9dc0587c53ceab4d9bcd14db882816', 5, 'active'),
  (42, 'swathi.p@sece.ac.in',  '1e9b38de300be8453122d0138c5854010c9dc0587c53ceab4d9bcd14db882816', 5, 'active'),
  (43, 'gokul.a@sece.ac.in',   '1e9b38de300be8453122d0138c5854010c9dc0587c53ceab4d9bcd14db882816', 5, 'active');

-- ============================================================================
-- 7. FACULTY  (rules 4, 6, 7)
--    1 HOD + 5 mentors in CSE (5 classes), 1 HOD + 4 mentors in AIDS
--    (4 classes), 1 HOD + 4 mentors in ECE (4 classes) = 16 faculty.
--    Each mentor is tied to exactly one class later in class_mentors
--    (rule 6). HODs additionally teach one flagship subject across every
--    class of their own department, both batches — up to 5 classes, still
--    under the "max 6 classes, different batches" ceiling (rule 4).
-- ============================================================================
INSERT INTO faculty (id, user_id, first_name, last_name, designation, department_id, date_of_joining, status, is_mentor, gender, personal_email, qualification, employment_status, employment_type) OVERRIDING SYSTEM VALUE VALUES
  (1,  28, 'Suresh',  'Kumar',      'Professor & Head',        1, '2010-06-01', 'active', false, 'male',   'suresh.kumar.hod@gmail.com',  'Ph.D',  'confirmed', 'full_time'),
  (2,  29, 'Arun',    'Prakash',    'Associate Professor',     1, '2015-07-10', 'active', true,  'male',   'arun.prakash@gmail.com',      'M.E',   'confirmed', 'full_time'),
  (3,  30, 'Divya',   'Bharathi',   'Assistant Professor',     1, '2018-06-15', 'active', true,  'female', 'divya.bharathi@gmail.com',    'M.E',   'confirmed', 'full_time'),
  (4,  31, 'Karthik', 'Raja',       'Assistant Professor',     1, '2017-08-20', 'active', true,  'male',   'karthik.raja@gmail.com',      'M.Tech','confirmed', 'full_time'),
  (5,  32, 'Priya',   'Dharshini',  'Assistant Professor',     1, '2019-06-01', 'active', true,  'female', 'priya.dharshini@gmail.com',   'M.E',   'confirmed', 'full_time'),
  (6,  33, 'Manoj',   'Kumar',      'Assistant Professor',     1, '2020-07-01', 'active', true,  'male',   'manoj.kumar@gmail.com',       'M.Tech','probation', 'full_time'),
  (7,  34, 'Lakshmi', 'Narayanan',  'Professor & Head',        2, '2011-06-01', 'active', false, 'female', 'lakshmi.narayanan.hod@gmail.com', 'Ph.D', 'confirmed', 'full_time'),
  (8,  35, 'Anitha',  'Selvam',     'Associate Professor',     2, '2016-06-10', 'active', true,  'female', 'anitha.selvam@gmail.com',     'M.E',   'confirmed', 'full_time'),
  (9,  36, 'Vignesh', 'Waran',      'Assistant Professor',     2, '2018-07-01', 'active', true,  'male',   'vignesh.waran@gmail.com',     'M.Tech','confirmed', 'full_time'),
  (10, 37, 'Kavya',   'Shree',      'Assistant Professor',     2, '2019-08-01', 'active', true,  'female', 'kavya.shree@gmail.com',       'M.E',   'confirmed', 'full_time'),
  (11, 38, 'Bala',    'Murugan',    'Assistant Professor',     2, '2020-06-15', 'active', true,  'male',   'bala.murugan@gmail.com',      'M.Tech','probation', 'full_time'),
  (12, 39, 'Ramesh',  'Babu',       'Professor & Head',        3, '2009-06-01', 'active', false, 'male',   'ramesh.babu.hod@gmail.com',   'Ph.D',  'confirmed', 'full_time'),
  (13, 40, 'Deepa',   'Rani',       'Associate Professor',     3, '2014-06-20', 'active', true,  'female', 'deepa.rani@gmail.com',        'M.E',   'confirmed', 'full_time'),
  (14, 41, 'Naveen',  'Kumar',      'Assistant Professor',     3, '2017-07-05', 'active', true,  'male',   'naveen.kumar@gmail.com',      'M.Tech','confirmed', 'full_time'),
  (15, 42, 'Swathi',  'Priya',      'Assistant Professor',     3, '2019-06-01', 'active', true,  'female', 'swathi.priya@gmail.com',      'M.E',   'confirmed', 'full_time'),
  (16, 43, 'Gokul',   'Anand',      'Assistant Professor',     3, '2021-07-01', 'active', true,  'male',   'gokul.anand@gmail.com',       'M.Tech','probation', 'full_time');

-- ============================================================================
-- 8. CLASS MENTORS  (rule 6: each mentor faculty maps to exactly one class)
-- ============================================================================
INSERT INTO class_mentors (class_id, faculty_id, academic_year, assigned_by_user_id) VALUES
  (1,  2,  '2025-2026', 28),
  (2,  3,  '2025-2026', 28),
  (3,  4,  '2025-2026', 28),
  (8,  5,  '2025-2026', 28),
  (9,  6,  '2025-2026', 28),
  (4,  8,  '2025-2026', 34),
  (5,  9,  '2025-2026', 34),
  (10, 10, '2025-2026', 34),
  (11, 11, '2025-2026', 34),
  (6,  13, '2025-2026', 39),
  (7,  14, '2025-2026', 39),
  (12, 15, '2025-2026', 39),
  (13, 16, '2025-2026', 39);

-- ============================================================================
-- Helper: academic_year string for a given (batch, semester). Used by every
-- insert below that needs one. Dropped again at the very end of this file —
-- it exists only to avoid repeating the same CASE expression 6+ times.
-- ============================================================================
CREATE OR REPLACE FUNCTION _seed_academic_year(p_batch_id int, p_semester int) RETURNS varchar AS $$
  SELECT CASE
    WHEN p_batch_id = 1 AND p_semester IN (1,2) THEN '2022-2023'
    WHEN p_batch_id = 1 AND p_semester IN (3,4) THEN '2023-2024'
    WHEN p_batch_id = 1 AND p_semester IN (5,6) THEN '2024-2025'
    WHEN p_batch_id = 1 AND p_semester = 7      THEN '2025-2026'
    WHEN p_batch_id = 2 AND p_semester IN (1,2) THEN '2023-2024'
    WHEN p_batch_id = 2 AND p_semester = 3      THEN '2024-2025'
  END;
$$ LANGUAGE sql IMMUTABLE;

-- ============================================================================
-- 9. FACULTY <-> SUBJECT <-> CLASS TEACHING ASSIGNMENTS (rules 4, 7)
--    (a) Each HOD teaches their department's "flagship" (semester-1, first)
--        subject across every class in their own department, both batches —
--        <= 6 distinct classes, spanning different batches (rule 4).
--    (b) Every other subject in a class is taught by that class's own
--        mentor. A mentor therefore only ever touches their own class
--        (rule 6), and only within their own department (rule 7).
-- ============================================================================
WITH dept_hod AS (
  SELECT department_id, id AS hod_faculty_id FROM faculty WHERE designation = 'Professor & Head'
), dept_flagship AS (
  SELECT department_id, MIN(id) AS subject_id FROM subjects GROUP BY department_id
)
INSERT INTO faculty_subject_class_mapping (faculty_id, subject_id, class_id, academic_year)
SELECT dh.hod_faculty_id, df.subject_id, cs.class_id, _seed_academic_year(c.batch_id, cs.semester)
FROM class_subjects cs
JOIN classes c ON c.id = cs.class_id
JOIN dept_hod dh ON dh.department_id = c.department_id
JOIN dept_flagship df ON df.department_id = c.department_id AND df.subject_id = cs.subject_id;

WITH dept_flagship AS (
  SELECT department_id, MIN(id) AS subject_id FROM subjects GROUP BY department_id
)
INSERT INTO faculty_subject_class_mapping (faculty_id, subject_id, class_id, academic_year)
SELECT cm.faculty_id, cs.subject_id, cs.class_id, _seed_academic_year(c.batch_id, cs.semester)
FROM class_subjects cs
JOIN classes c ON c.id = cs.class_id
JOIN class_mentors cm ON cm.class_id = cs.class_id
LEFT JOIN dept_flagship df ON df.department_id = c.department_id AND df.subject_id = cs.subject_id
WHERE df.subject_id IS NULL;

-- ============================================================================
-- 10. STUDENTS  (rules 8, 12, 15) — set-based generator
--     Every class gets exactly 10 students (rule 8). A temp working table
--     computes names/roll numbers/emails once; it is dropped at the very
--     end of this file so nothing extra is left behind in the schema.
--     roll_no = <batchYY><DEPTCODE><serial>, serial continuing in blocks of
--     10 across sections (rule 15, e.g. Sec A 22AD001-010, Sec B 22AD011-020)
--     email    = <firstname>.<last-initial><batchStartYear><deptSlug>@sece.ac.in
--     (rule 12, e.g. raja.k2022aids@sece.ac.in)
-- ============================================================================
DROP TABLE IF EXISTS _seed_students_tmp;
CREATE TABLE _seed_students_tmp AS
SELECT
  s.*,
  (ARRAY['Arjun','Divya','Karthik','Priya','Vishnu','Sneha','Arun','Meena','Naveen','Deepika','Vignesh','Kavitha','Suriya'])[((s.rn-1) % 13) + 1] AS first_name,
  (ARRAY['Kumar','Raj','Prasad','Devi','Krishnan','Lakshmi','Narayan','Bharathi','Selvam','Murthy'])[((s.rn-1) % 10) + 1] AS last_name,
  CASE WHEN s.rn % 2 = 0 THEN 'Female' ELSE 'Male' END AS gender
FROM (
  SELECT
    ROW_NUMBER() OVER (ORDER BY c.id, seq) AS rn,
    c.id AS class_id,
    c.batch_id,
    c.department_id,
    b.start_year AS batch_start_year,
    d.code AS dept_code,
    (CASE d.id WHEN 1 THEN 'cse' WHEN 2 THEN 'aids' WHEN 3 THEN 'ece' END) AS dept_slug,
    c.section,
    seq AS serial_in_class
  FROM classes c
  JOIN batches b ON b.id = c.batch_id
  JOIN departments d ON d.id = c.department_id
  CROSS JOIN generate_series(1, 10) AS seq
) s;

ALTER TABLE _seed_students_tmp ADD COLUMN roll_no varchar;
ALTER TABLE _seed_students_tmp ADD COLUMN student_email varchar;
ALTER TABLE _seed_students_tmp ADD COLUMN user_id int;

UPDATE _seed_students_tmp SET
  roll_no = (batch_start_year % 100)::text || dept_code || lpad(((ascii(section) - 65) * 10 + serial_in_class)::text, 3, '0'),
  user_id = 43 + rn;

UPDATE _seed_students_tmp SET
  student_email = lower(first_name) || '.' || lower(left(last_name, 1)) || batch_start_year::text || dept_slug || '@sece.ac.in';

INSERT INTO users (id, email, password_hash, role_id, status) OVERRIDING SYSTEM VALUE
SELECT user_id, student_email, '1e9b38de300be8453122d0138c5854010c9dc0587c53ceab4d9bcd14db882816', 6, 'active'
FROM _seed_students_tmp ORDER BY rn;

INSERT INTO students (
  id, user_id, student_id_no, roll_no, register_no, admission_no, course_id, quota_id,
  class_id, batch_id, admission_date, joined_academic_year, gender, date_of_birth,
  student_type, dayscholar_mode, vehicle_number, status, nationality
)  OVERRIDING SYSTEM VALUE
SELECT
  rn,
  user_id,
  roll_no,
  roll_no,
  'REG' || roll_no,
  'ADM' || roll_no,
  department_id,                                              -- course ids mirror department ids 1:1
  (CASE WHEN rn % 11 = 0 THEN 3 WHEN rn % 7 = 0 THEN 4 WHEN rn % 3 = 0 THEN 2 ELSE 1 END),
  class_id,
  batch_id,
  make_date(batch_start_year, 6, 15),
  batch_start_year::text || '-' || (batch_start_year + 1)::text,
  gender,
  make_date((batch_start_year - 18)::int, (1 + (rn % 12))::int, (1 + (rn % 27))::int),
  (CASE WHEN rn % 3 = 0 THEN 'hosteller' ELSE 'dayscholar' END)::student_type_enum,
  (CASE WHEN rn % 3 <> 0 THEN (CASE WHEN rn % 2 = 0 THEN 'transport' ELSE 'own_vehicle' END)::dayscholar_mode_enum END),
  -- required whenever dayscholar_mode = 'own_vehicle' (students_check1)
  (CASE WHEN rn % 3 <> 0 AND rn % 2 <> 0 THEN 'TN-' || lpad((37 + (rn % 60))::text, 2, '0') || '-' || chr((65 + (rn % 26))::int) || '-' || lpad(rn::text, 4, '0') END),
  (CASE WHEN rn IN (5, 77) THEN 'inactive' ELSE 'active' END)::user_status_enum,
  'Indian'
FROM _seed_students_tmp
ORDER BY rn;

INSERT INTO student_contacts (student_id, student_email1, student_mobile)
SELECT rn, student_email, '9' || lpad((100000000 + rn)::text, 9, '0')
FROM _seed_students_tmp;

-- ============================================================================
-- 11. PARENTS  (one parent per class, linked to that class's first student)
-- ============================================================================
DROP TABLE IF EXISTS _seed_parent_tmp;
CREATE TABLE _seed_parent_tmp AS
SELECT
  c.id AS class_id,
  st.id AS student_id,
  st.roll_no,
  173 + ROW_NUMBER() OVER (ORDER BY c.id) AS parent_user_id
FROM classes c
JOIN students st ON st.class_id = c.id AND st.roll_no = (SELECT MIN(s2.roll_no) FROM students s2 WHERE s2.class_id = c.id);

INSERT INTO users (id, email, password_hash, role_id, status) OVERRIDING SYSTEM VALUE
SELECT parent_user_id, 'parentof.' || lower(roll_no) || '@gmail.com', '1e9b38de300be8453122d0138c5854010c9dc0587c53ceab4d9bcd14db882816', 7, 'active'
FROM _seed_parent_tmp ORDER BY parent_user_id;

INSERT INTO parent_student_mapping (parent_user_id, student_id, relationship)
SELECT parent_user_id, student_id,
  (CASE WHEN class_id % 3 = 0 THEN 'guardian' WHEN class_id % 2 = 0 THEN 'mother' ELSE 'father' END)::parent_relationship_enum
FROM _seed_parent_tmp;

-- ============================================================================
-- 12. NON-TEACHING STAFF  (one row per staff_category_enum value)
-- ============================================================================
INSERT INTO users (id, email, password_hash, role_id, status) OVERRIDING SYSTEM VALUE VALUES
  (187, 'housekeeping.staff@eos.test', '1e9b38de300be8453122d0138c5854010c9dc0587c53ceab4d9bcd14db882816', 14, 'active'),
  (188, 'labassistant.staff@eos.test', '1e9b38de300be8453122d0138c5854010c9dc0587c53ceab4d9bcd14db882816', 14, 'active');

INSERT INTO non_teaching_staff (id, user_id, first_name, last_name, category, department_id, date_of_joining, status) OVERRIDING SYSTEM VALUE VALUES
  (1, 187, 'Muthu',    'Selvan',   'housekeeping', NULL, '2018-04-01', 'active'),
  (2, 188, 'Rajendran','Pillai',   'lab_assistant', 1,   '2016-06-01', 'active'),
  (3, NULL,'Kamala',   'Devi',     'office',        NULL,'2019-03-15', 'active'),
  (4, NULL,'Selvi',    'Ammal',    'security',      NULL,'2020-01-10', 'active'),
  (5, NULL,'Ravi',     'Shankar',  'other',         NULL,'2021-09-01', 'inactive');

-- ============================================================================
-- 13. FEE STRUCTURE (rows exercise every fee_structure_applies_to_enum value)
-- ============================================================================
INSERT INTO demand_categories (id, name) OVERRIDING SYSTEM VALUE VALUES
  (1, 'Tuition Fee'),
  (2, 'Hostel Fee'),
  (3, 'Transport Fee'),
  (4, 'Examination Fee'),
  (5, 'Library Fee');

INSERT INTO fee_structures (id, name, applies_to, quota_id, academic_year) OVERRIDING SYSTEM VALUE VALUES
  (1, 'Government Quota Tuition 2025-26', 'quota',     1,    '2025-2026'),
  (2, 'Management Quota Tuition 2025-26', 'quota',     2,    '2025-2026'),
  (3, 'Hostel Fee 2025-26',               'hostel',    NULL, '2025-2026'),
  (4, 'Transport Fee 2025-26',            'transport', NULL, '2025-2026');

INSERT INTO fee_structure_items (fee_structure_id, demand_category_id, amount) VALUES
  (1, 1, 65000.00),
  (1, 4, 2000.00),
  (2, 1, 125000.00),
  (2, 4, 2000.00),
  (3, 2, 55000.00),
  (4, 3, 18000.00);

-- ============================================================================
-- 14. HOSTELS  (rules 10, 11)
--     2 hostels (Boys/Girls), 1 block each, 4 floors x 15 rooms/floor,
--     capacity 4/room. room_number = "<Block>-<FloorLetter><1-15>".
-- ============================================================================
INSERT INTO users (id, email, password_hash, role_id, status) OVERRIDING SYSTEM VALUE VALUES
  (189, 'boys.warden@sece.ac.in',  '1e9b38de300be8453122d0138c5854010c9dc0587c53ceab4d9bcd14db882816', 9, 'active'),
  (190, 'girls.warden@sece.ac.in', '1e9b38de300be8453122d0138c5854010c9dc0587c53ceab4d9bcd14db882816', 9, 'active');

INSERT INTO hostels (id, name, code, wing, warden_user_id, phone, mess_type, established_year) OVERRIDING SYSTEM VALUE VALUES
  (1, 'Boys Hostel',  'BH', 'boys',  189, '9443300001', 'Veg & Non-Veg', 2005),
  (2, 'Girls Hostel', 'GH', 'girls', 190, '9443300002', 'Veg',           2008);

INSERT INTO hostel_blocks (id, hostel_id, name, floors) OVERRIDING SYSTEM VALUE VALUES
  (1, 1, 'A', 4),
  (2, 2, 'A', 4);

INSERT INTO hostel_room_types (id, name) OVERRIDING SYSTEM VALUE VALUES
  (1, 'Four Sharing'),
  (2, 'Two Sharing');

INSERT INTO hostel_rooms (room_number, room_type_id, capacity, hostel_id, block_id)
SELECT hb.name || '-' || fl.letter || rm.n, 1, 4, hb.hostel_id, hb.id
FROM hostel_blocks hb
CROSS JOIN (VALUES ('G', 0), ('F', 1), ('S', 2), ('T', 3)) AS fl(letter, idx)
CROSS JOIN generate_series(1, 15) AS rm(n)
ORDER BY hb.id, fl.idx, rm.n;

INSERT INTO hostel_wardens (id, user_id, name, emp_id, role, gender, designation, block_id, mobile, email, joined_date) OVERRIDING SYSTEM VALUE VALUES
  (1, 189, 'Muthusamy Pillai', 'WRD001', 'super_warden', 'male',   'Chief Warden', 1, '9443300001', 'boys.warden@sece.ac.in',  '2015-06-01'),
  (2, 190, 'Kalaivani Raman',  'WRD002', 'sub_warden',   'female', 'Warden',       2, '9443300002', 'girls.warden@sece.ac.in', '2017-06-01');

-- One faculty member (unmarried junior lecturer) staying in hostel quarters.
INSERT INTO faculty_hostel_mapping (faculty_id, room_id, fee_structure_id)
SELECT 6, hr.id, 3 FROM hostel_rooms hr WHERE hr.room_number = 'A-T1' AND hr.hostel_id = 1;

-- Every 3rd student is a hosteller (rn % 3 = 0, see section 10). Allocate
-- them 4-per-room, boys -> Boys Hostel, girls -> Girls Hostel.
WITH hostellers AS (
  SELECT s.id AS student_id, s.gender,
         ROW_NUMBER() OVER (PARTITION BY s.gender ORDER BY s.id) AS rn
  FROM students s WHERE s.student_type = 'hosteller'
), rooms_boys AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY id) AS rn FROM hostel_rooms WHERE hostel_id = 1
), rooms_girls AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY id) AS rn FROM hostel_rooms WHERE hostel_id = 2
)
INSERT INTO student_hostel_mapping (student_id, room_id, fee_structure_id)
SELECT h.student_id,
       CASE WHEN h.gender = 'Male' THEN rb.id ELSE rg.id END,
       3
FROM hostellers h
LEFT JOIN rooms_boys  rb ON h.gender = 'Male'   AND rb.rn = ((h.rn - 1) / 4) + 1
LEFT JOIN rooms_girls rg ON h.gender = 'Female' AND rg.rn = ((h.rn - 1) / 4) + 1;

-- ============================================================================
-- 15. TRANSPORT
-- ============================================================================
INSERT INTO transport_routes (id, name) OVERRIDING SYSTEM VALUE VALUES
  (1, 'Route 1 - City Center to Campus'),
  (2, 'Route 2 - Airport Road to Campus');

INSERT INTO transport_stages (id, route_id, stage_name, sequence_no, fee_amount) OVERRIDING SYSTEM VALUE VALUES
  (1, 1, 'Town Bus Stand', 1, 3000.00),
  (2, 1, 'Railway Station', 2, 4000.00),
  (3, 1, 'City Center',     3, 5000.00),
  (4, 2, 'Airport Road',    1, 3500.00),
  (5, 2, 'Tech Park',       2, 4500.00),
  (6, 2, 'Old Bus Stand',   3, 5500.00);

INSERT INTO buses (id, route_id, vehicle_number, driver_name, gps_device_id, bus_no) OVERRIDING SYSTEM VALUE VALUES
  (1, 1, 'TN-99-AB-1234', 'Murugan',  'GPS-DEV-001', 'BUS-01'),
  (2, 2, 'TN-99-CD-5678', 'Selvaraj', 'GPS-DEV-002', 'BUS-02');

INSERT INTO bus_live_locations (bus_id, latitude, longitude) VALUES
  (1, 11.016845, 76.955832),
  (2, 11.020000, 76.960000);

INSERT INTO student_transport_mapping (student_id, route_id, boarding_stage_id, destination_stage_id, fee_structure_id)
SELECT id, 1, 1, 3, 4 FROM students WHERE dayscholar_mode = 'transport' ORDER BY id LIMIT 5;

INSERT INTO student_transport_mapping (student_id, route_id, boarding_stage_id, destination_stage_id, fee_structure_id)
SELECT id, 2, 4, 6, 4 FROM students WHERE dayscholar_mode = 'transport' ORDER BY id OFFSET 5 LIMIT 5;

-- ============================================================================
-- 16. VENUES  (needed by exams/media/bookings below)
-- ============================================================================
INSERT INTO venues (id, name, location, capacity) OVERRIDING SYSTEM VALUE VALUES
  (1, 'Examination Hall 1',   'Block A, Ground Floor', 120),
  (2, 'Examination Hall 2',   'Block A, First Floor',  120),
  (3, 'Seminar Hall',         'Block B, Second Floor', 200),
  (4, 'Main Auditorium',      'Admin Block',           500);

-- ============================================================================
-- 17. EXAM TYPES  (rule 16: 2 internals + 1 university exam per semester)
-- ============================================================================
INSERT INTO exam_types (id, name, category, code, is_university) OVERRIDING SYSTEM VALUE VALUES
  (1, 'Internal Assessment I',            'internal', 'IA1',   false),
  (2, 'Internal Assessment II',           'internal', 'IA2',   false),
  (3, 'University Semester Examination',  'external', 'UNIV',  true),
  (4, 'Model Examination',                'internal', 'MODEL', false);

-- ============================================================================
-- 18. EXAMS  (rule 16 — every semester up to 6 that a batch has completed
--     gets all 3 exams, fully results-published except the very latest
--     university exam of each batch which is left "completed" (conducted,
--     awaiting result publication) so both exam_status_enum end-states are
--     exercised. Each batch's *current* semester also gets exam shells in
--     earlier lifecycle states (created / timetable_published) with no
--     marks yet, to demonstrate the in-progress workflow.)
-- ============================================================================
WITH completed_sems AS (
  SELECT 1 AS batch_id, s AS semester FROM generate_series(1, 6) s
  UNION ALL
  SELECT 2, s FROM generate_series(1, 2) s
), types3 AS (
  SELECT * FROM (VALUES (1), (2), (3)) AS t(exam_type_id)
)
INSERT INTO exams (exam_type_id, batch_id, academic_year, semester, status, title, created_by_user_id)
SELECT
  t.exam_type_id, cs.batch_id, _seed_academic_year(cs.batch_id, cs.semester), cs.semester,
  (CASE WHEN cs.batch_id = 1 AND cs.semester = 6 AND t.exam_type_id = 3 THEN 'completed'
        WHEN cs.batch_id = 2 AND cs.semester = 2 AND t.exam_type_id = 3 THEN 'completed'
        ELSE 'results_published' END)::exam_status_enum,
  et.name || ' - Semester ' || cs.semester,
  16
FROM completed_sems cs
CROSS JOIN types3 t
JOIN exam_types et ON et.id = t.exam_type_id
ORDER BY cs.batch_id, cs.semester, t.exam_type_id;

INSERT INTO exams (exam_type_id, batch_id, academic_year, semester, status, title, created_by_user_id) VALUES
  (1, 1, '2025-2026', 7, 'timetable_published', 'Internal Assessment I - Semester 7', 16),
  (1, 2, '2024-2025', 3, 'timetable_published', 'Internal Assessment I - Semester 3', 16),
  (2, 2, '2024-2025', 3, 'created',             'Internal Assessment II - Semester 3', 16);

-- ============================================================================
-- 19. EXAM <-> CLASS <-> SUBJECT MAPPING  (every exam fans out to every
--     class of its batch and every subject that class has for that
--     semester — i.e. it mirrors class_subjects one-to-one per exam).
-- ============================================================================
INSERT INTO exam_subject_mapping (exam_id, class_id, subject_id, is_published, published_at, is_elective)
SELECT
  e.id, cs.class_id, cs.subject_id,
  (e.status IN ('results_published', 'completed')),
  (CASE WHEN e.status IN ('results_published', 'completed') THEN e.created_at END),
  cs.is_elective
FROM exams e
JOIN classes c ON c.batch_id = e.batch_id
JOIN class_subjects cs ON cs.class_id = c.id AND cs.semester = e.semester;

-- ============================================================================
-- 20. EXAM MARKS  (rule 16 — every student, every subject, every one of the
--     3 exams, for every semester the student has completed up to sem 6).
--     Marks are deterministic-but-varied (40-90% of max); a small,
--     deterministic slice is absent (marks_obtained NULL) or moderated, to
--     exercise those flags too. Internal exams are out of 50, university
--     exams out of 100.
-- ============================================================================
INSERT INTO exam_marks (exam_subject_mapping_id, student_id, marks_obtained, max_marks, entered_by_faculty_id, is_absent, is_moderated)
SELECT
  esm.id,
  st.id,
  (CASE WHEN ((st.id + esm.subject_id) % 37) = 0 THEN NULL
        ELSE round((CASE WHEN e.exam_type_id = 3 THEN 100 ELSE 50 END) *
                    (0.40 + (((st.id * 7 + esm.subject_id * 3) % 50)::numeric / 100)), 2)
   END),
  (CASE WHEN e.exam_type_id = 3 THEN 100 ELSE 50 END),
  fscm.faculty_id,
  (((st.id + esm.subject_id) % 37) = 0),
  (((st.id + esm.subject_id) % 29) = 0)
FROM exam_subject_mapping esm
JOIN exams e ON e.id = esm.exam_id
JOIN students st ON st.class_id = esm.class_id
LEFT JOIN faculty_subject_class_mapping fscm ON fscm.subject_id = esm.subject_id AND fscm.class_id = esm.class_id
WHERE e.status IN ('results_published', 'completed');

-- ============================================================================
-- 21. MARKS ENTRY LOCKS / RESULT PUBLICATIONS
-- ============================================================================
INSERT INTO marks_entry_locks (exam_id, department_id, is_locked, locked_by_user_id, locked_at, is_published, published_by_user_id, published_at)
SELECT
  e.id, d.id, true, 16, e.created_at,
  (e.status = 'results_published'),
  (CASE WHEN e.status = 'results_published' THEN 16 END),
  (CASE WHEN e.status = 'results_published' THEN e.created_at END)
FROM exams e
CROSS JOIN departments d
WHERE e.status IN ('results_published', 'completed');

INSERT INTO result_publications (exam_id, publication_type, published_by_user_id)
SELECT id, 'original', 16 FROM exams WHERE status = 'results_published';

-- ============================================================================
-- 22. GRADE BANDS / PASS RULES (static reference data, singleton settings)
-- ============================================================================
INSERT INTO grade_bands (grade_label, min_percentage, grade_point, is_pass, display_order) VALUES
  ('O',  91, 10, true,  1),
  ('A+', 81, 9,  true,  2),
  ('A',  71, 8,  true,  3),
  ('B+', 61, 7,  true,  4),
  ('B',  56, 6,  true,  5),
  ('C',  50, 5,  true,  6),
  ('U',  0,  0,  false, 7);

INSERT INTO exam_pass_rules_settings DEFAULT VALUES;

-- ============================================================================
-- 23. HALL TICKETS & MARKSHEETS  (every completed university exam, every
--     student of that batch)
-- ============================================================================
INSERT INTO hall_tickets (exam_id, student_id, file_url)
SELECT e.id, st.id, '/files/hall-tickets/' || st.roll_no || '-exam' || e.id || '.pdf'
FROM exams e
JOIN classes c ON c.batch_id = e.batch_id
JOIN students st ON st.class_id = c.id
WHERE e.exam_type_id = 3 AND e.status IN ('results_published', 'completed');

INSERT INTO marksheets (exam_id, student_id, file_url)
SELECT e.id, st.id, '/files/marksheets/' || st.roll_no || '-exam' || e.id || '.pdf'
FROM exams e
JOIN classes c ON c.batch_id = e.batch_id
JOIN students st ON st.class_id = c.id
WHERE e.exam_type_id = 3 AND e.status IN ('results_published', 'completed');

-- ============================================================================
-- 24. ACADEMIC CALENDAR / HOLIDAYS / EVENTS
-- ============================================================================
INSERT INTO academic_calendars (batch_id, semester, start_date, end_date, created_by_user_id)
SELECT
  b.id, sem,
  make_date(split_part(_seed_academic_year(b.id, sem), '-', 1)::int, (CASE WHEN sem % 2 = 1 THEN 7 ELSE 12 END), 1),
  (make_date(split_part(_seed_academic_year(b.id, sem), '-', 1)::int, (CASE WHEN sem % 2 = 1 THEN 7 ELSE 12 END), 1) + interval '5 months')::date,
  16
FROM batches b
CROSS JOIN generate_series(1, 7) AS sem
WHERE (b.id = 1) OR (b.id = 2 AND sem <= 3);

INSERT INTO holiday_slots (id, name, from_date, to_date) OVERRIDING SYSTEM VALUE VALUES
  (1, 'Diwali Break',     '2025-10-20', '2025-10-24'),
  (2, 'Pongal Break',     '2026-01-14', '2026-01-16'),
  (3, 'Summer Vacation',  '2026-05-01', '2026-06-15');

INSERT INTO calendar_events (academic_calendar_id, event_date, description, event_type, title, created_by_user_id)
SELECT ac.id, '2025-10-22', 'Institution closed for Diwali', 'holiday', 'Diwali Holiday', 16
FROM academic_calendars ac WHERE ac.batch_id = 1 AND ac.semester = 7;

INSERT INTO calendar_events (academic_calendar_id, event_date, description, event_type, title, start_time, end_time, created_by_user_id)
SELECT ac.id, '2026-01-15', 'Annual technical symposium', 'event', 'TechFest 2026', '09:00', '17:00', 16
FROM academic_calendars ac WHERE ac.batch_id = 2 AND ac.semester = 3;

INSERT INTO faculty_holiday_mapping (faculty_id, holiday_slot_id) VALUES
  (1, 1), (7, 1), (12, 1), (1, 3), (7, 3), (12, 3);

-- ============================================================================
-- 25. CURRENT-SEMESTER TEACHING OPS (timetable, lesson plans, assignments,
--     submissions, LMS notes) — scoped to each class's *current* semester
--     only, to keep volume proportionate to "what's happening right now".
-- ============================================================================
DROP TABLE IF EXISTS _seed_current_subjects_tmp;
CREATE TABLE _seed_current_subjects_tmp AS
SELECT cs.class_id, cs.subject_id, c.batch_id, c.current_semester,
       ROW_NUMBER() OVER (PARTITION BY cs.class_id ORDER BY cs.subject_id) AS rn,
       COALESCE(fscm.faculty_id, cm.faculty_id) AS teaching_faculty_id
FROM class_subjects cs
JOIN classes c ON c.id = cs.class_id
JOIN class_mentors cm ON cm.class_id = cs.class_id
LEFT JOIN faculty_subject_class_mapping fscm
  ON fscm.class_id = cs.class_id AND fscm.subject_id = cs.subject_id
  AND fscm.academic_year = _seed_academic_year(c.batch_id, c.current_semester)
WHERE cs.semester = c.current_semester;

INSERT INTO timetable_slots (class_id, subject_id, faculty_id, day_of_week, period_number, start_time, end_time, academic_year, semester)
SELECT class_id, subject_id, teaching_faculty_id, rn, rn,
  (time '09:00:00' + ((rn - 1) * interval '1 hour'))::time,
  (time '09:00:00' + (rn * interval '1 hour'))::time,
  _seed_academic_year(batch_id, current_semester), current_semester
FROM _seed_current_subjects_tmp;

INSERT INTO lesson_plans (faculty_id, subject_id, class_id, semester, content)
SELECT csub.teaching_faculty_id, csub.subject_id, csub.class_id, csub.current_semester,
  'Unit-wise lesson plan covering the syllabus of ' || sub.name || ' for semester ' || csub.current_semester || '.'
FROM _seed_current_subjects_tmp csub JOIN subjects sub ON sub.id = csub.subject_id;

INSERT INTO lms_notes (subject_id, class_id, faculty_id, title, file_url)
SELECT csub.subject_id, csub.class_id, csub.teaching_faculty_id,
  sub.name || ' - Unit 1 Notes',
  '/files/lms-notes/' || sub.subject_code || '-unit1.pdf'
FROM _seed_current_subjects_tmp csub JOIN subjects sub ON sub.id = csub.subject_id;

INSERT INTO assignments (class_id, subject_id, faculty_id, academic_year, semester, sequence_no, title)
SELECT class_id, subject_id, teaching_faculty_id, _seed_academic_year(batch_id, current_semester), current_semester, 1,
  'Assignment 1'
FROM _seed_current_subjects_tmp;

INSERT INTO student_assignment_status (assignment_id, student_id, is_submitted, marked_by_faculty_id, marked_at)
SELECT a.id, st.id,
  (((st.id + a.id) % 4) <> 0),
  a.faculty_id,
  (CASE WHEN ((st.id + a.id) % 4) <> 0 THEN now() - interval '2 days' END)
FROM assignments a
JOIN students st ON st.class_id = a.class_id;

-- ============================================================================
-- 26. FEEDBACK  (one form per batch, covers both feedback_question_type_enum
--     values and every feedback_rating_label_enum value)
-- ============================================================================
INSERT INTO feedback_forms (id, created_by_user_id, title, batch_id) OVERRIDING SYSTEM VALUE VALUES
  (1, 16, 'Course & Faculty Feedback - 2025-26 Odd Semester', 1),
  (2, 16, 'Course & Faculty Feedback - 2024-25 Even Semester', 2);

INSERT INTO feedback_questions (id, form_id, question_text, sequence_no, question_type) OVERRIDING SYSTEM VALUE VALUES
  (1, 1, 'How would you rate the pace of teaching?',            1, 'rating'),
  (2, 1, 'How would you rate the clarity of concepts explained?', 2, 'rating'),
  (3, 1, 'Any suggestions for improvement?',                     3, 'text'),
  (4, 2, 'How would you rate the pace of teaching?',            1, 'rating'),
  (5, 2, 'How would you rate the clarity of concepts explained?', 2, 'rating'),
  (6, 2, 'Any suggestions for improvement?',                     3, 'text');

INSERT INTO feedback_responses (question_id, student_id, response_text, rating_value, rating_label)
SELECT q.id, st.id, NULL,
  (1 + ((st.id + q.id) % 5)),
  (ARRAY['need_improvement','satisfactory','good','very_good','excellent']::feedback_rating_label_enum[])[1 + ((st.id + q.id) % 5)]
FROM feedback_questions q
JOIN classes c ON c.batch_id = (CASE WHEN q.form_id = 1 THEN 1 ELSE 2 END)
JOIN students st ON st.class_id = c.id AND st.roll_no LIKE '%001'
WHERE q.question_type = 'rating';

INSERT INTO feedback_responses (question_id, student_id, response_text)
SELECT q.id, st.id, 'Overall good, would like more hands-on lab sessions.'
FROM feedback_questions q
JOIN classes c ON c.batch_id = (CASE WHEN q.form_id = 1 THEN 1 ELSE 2 END)
JOIN students st ON st.class_id = c.id AND st.roll_no LIKE '%001'
WHERE q.question_type = 'text';

-- ============================================================================
-- 27. ANNOUNCEMENTS  (covers every target_audience_enum + announcement_status_enum value)
-- ============================================================================
INSERT INTO announcements (id, posted_by_user_id, title, content, target_audience, batch_id, department_id, status) OVERRIDING SYSTEM VALUE VALUES
  (1, 28, 'Semester 7 Timetable Released',        'Please check the timetable section for your updated class schedule.', 'students', 1,    1,    'published'),
  (2, 16, 'University Exam Hall Tickets Available','Hall tickets for the semester exams have been generated. Download from the portal.', 'students', NULL, NULL, 'published'),
  (3, 3,  'Parent-Teacher Meeting - August 2026',  'A parent-teacher meeting is scheduled for all first-year and second-year parents.', 'parents', 2, NULL, 'published'),
  (4, 3,  'Faculty Development Program',           'All teaching faculty are required to attend the FDP on outcome-based education.', 'teachers', NULL, NULL, 'published'),
  (5, 1,  'Revised Leave Policy (Draft)',          'Draft circular on the revised staff leave policy, pending management approval.', 'roles', NULL, NULL, 'draft');

INSERT INTO announcement_class_mapping (announcement_id, class_id) VALUES
  (1, 1), (1, 2), (1, 3), (1, 4), (1, 5), (1, 6), (1, 7);

INSERT INTO announcement_role_mapping (announcement_id, role_id) VALUES
  (4, 4), (4, 5), (5, 4), (5, 2);

INSERT INTO notifications (user_id, title, message, is_read) VALUES
  (44, 'Timetable Updated',        'Your semester 7 timetable has been published.', false),
  (44, 'Hall Ticket Ready',        'Your hall ticket for the university exam is ready to download.', true),
  (28, 'New Bonafide Request',     'A student has requested a bonafide certificate.', false),
  (16, 'Marks Entry Pending',      'Semester 3 IA2 marks entry is still pending for 2 departments.', false),
  (1,  'System Maintenance',       'Scheduled maintenance window this weekend.', true);

-- ============================================================================
-- 28. BONAFIDE REQUESTS & CERTIFICATES  (covers bonafide_status_enum)
-- ============================================================================
INSERT INTO bonafide_reasons (id, reason_text) OVERRIDING SYSTEM VALUE VALUES
  (1, 'Bank Loan Application'),
  (2, 'Passport Application'),
  (3, 'Scholarship Application');

INSERT INTO bonafide_requests (student_id, reason_id, status, approved_by_faculty_id, issued_by_hod_user_id, issued_at) VALUES
  (1,  1, 'issued',           2, 28, now() - interval '10 days'),
  (11, 2, 'faculty_approved', 3, NULL, NULL),
  (21, 3, 'pending',          NULL, NULL, NULL),
  (31, 1, 'rejected',         8, NULL, NULL);

INSERT INTO certificate_types (id, name) OVERRIDING SYSTEM VALUE VALUES
  (1, 'Course Completion Certificate'),
  (2, 'Conduct Certificate'),
  (3, 'Transfer Certificate');

INSERT INTO student_certificates (student_id, certificate_type_id, is_available, file_url, verified_at) VALUES
  (1, 1, true,  '/files/certificates/22CS001-completion.pdf', now()),
  (1, 2, true,  '/files/certificates/22CS001-conduct.pdf',    now()),
  (11, 1, false, NULL, NULL);

-- ============================================================================
-- 29. LIBRARY  (covers borrow_status_enum, borrower_type_enum)
-- ============================================================================
INSERT INTO book_categories (id, name) OVERRIDING SYSTEM VALUE VALUES
  (1, 'Computer Science'),
  (2, 'Electronics'),
  (3, 'Mathematics'),
  (4, 'General / Fiction');

INSERT INTO library_racks (id, rack_code, shelves, subject_range) OVERRIDING SYSTEM VALUE VALUES
  (1, 'CS-A1',  4, 'CS101-CS605'),
  (2, 'EC-B1',  4, 'EC101-EC605'),
  (3, 'GEN-C1', 2, 'General Reading');

INSERT INTO books (id, qr_code, title, author, category_id, total_copies, available_copies, department_id, edition, isbn, price_per_copy, publisher, rack_id) OVERRIDING SYSTEM VALUE VALUES
  (1, 'QR-BK-0001', 'Introduction to Algorithms',              'Cormen, Leiserson, Rivest, Stein', 1, 5, 3, 1, '3rd', '9780262033848', 950.00,  'MIT Press',        1),
  (2, 'QR-BK-0002', 'Database System Concepts',                'Silberschatz, Korth, Sudarshan',   1, 4, 4, 1, '7th', '9780078022159', 850.00,  'McGraw-Hill',      1),
  (3, 'QR-BK-0003', 'Deep Learning',                           'Ian Goodfellow',                   1, 3, 2, 2, '1st', '9780262035613', 1200.00, 'MIT Press',        1),
  (4, 'QR-BK-0004', 'Digital Signal Processing',               'John G. Proakis',                  2, 4, 3, 3, '4th', '9780131873742', 780.00,  'Pearson',          2),
  (5, 'QR-BK-0005', 'Microelectronic Circuits',                'Sedra & Smith',                    2, 3, 3, 3, '8th', '9780199339136', 900.00,  'Oxford',           2),
  (6, 'QR-BK-0006', 'Advanced Engineering Mathematics',        'Erwin Kreyszig',                   3, 6, 5, NULL,'10th','9780470458365', 650.00,  'Wiley',            3),
  (7, 'QR-BK-0007', 'Wings of Fire',                           'A.P.J. Abdul Kalam',               4, 3, 1, NULL,'1st', '9788173711466', 250.00,  'Universities Press', 3);

INSERT INTO library_settings (updated_at) VALUES (now());

INSERT INTO book_borrow_records (book_id, borrower_type, student_id, faculty_id, borrowed_date, due_date, returned_date, status, renewal_count) VALUES
  (1, 'student', 1,  NULL, CURRENT_DATE - 20, CURRENT_DATE - 6,  CURRENT_DATE - 7, 'returned', 0),
  (2, 'student', 11, NULL, CURRENT_DATE - 10, CURRENT_DATE + 4,  NULL,             'borrowed', 0),
  (3, 'student', 21, NULL, CURRENT_DATE - 40, CURRENT_DATE - 26, NULL,             'overdue',  1),
  (6, 'faculty', NULL, 3,  CURRENT_DATE - 15, CURRENT_DATE - 1,  NULL,             'lost',     0),
  (7, 'student', 31, NULL, CURRENT_DATE - 60, CURRENT_DATE - 46, CURRENT_DATE - 50,'damaged',  0);

INSERT INTO e_resources (title, url, category_id, format, license_type, uploaded_by_user_id, publish_state) VALUES
  ('IEEE Xplore Digital Library', 'https://ieeexplore.ieee.org', 1, 'web', 'institutional', 18, 'published'),
  ('NPTEL Video Lectures - Machine Learning', 'https://nptel.ac.in', 1, 'video', 'open', 18, 'published'),
  ('Draft e-book: Advanced VLSI Notes', '/files/e-resources/vlsi-draft.pdf', 2, 'pdf', 'internal', 18, 'draft');

-- ============================================================================
-- 30. PLACEMENTS  (covers drive_application_status_enum)
-- ============================================================================
INSERT INTO companies (id, name, profile_info) OVERRIDING SYSTEM VALUE VALUES
  (1, 'TCS',      'Global IT services and consulting company.'),
  (2, 'Zoho Corporation', 'Product-based software company.'),
  (3, 'Wipro',    'IT, consulting and business process services company.');

INSERT INTO placement_drives (id, company_id, scheduled_date, status, created_by_user_id, job_role, package_lpa, eligibility_cgpa, venue, registration_start, registration_end) OVERRIDING SYSTEM VALUE VALUES
  (1, 1, '2026-09-10', 'scheduled', 17, 'Systems Engineer',      3.5, 6.0, 'Main Auditorium', '2026-08-15', '2026-09-05'),
  (2, 2, '2026-08-20', 'completed', 17, 'Software Developer',    6.5, 7.5, 'Seminar Hall',    '2026-07-20', '2026-08-10'),
  (3, 3, '2026-10-05', 'scheduled', 17, 'Project Engineer',      4.0, 6.5, 'Main Auditorium', '2026-09-10', '2026-09-28');

INSERT INTO student_drive_applications (drive_id, student_id, status, updated_by_user_id, last_cleared_round, offered_package) VALUES
  (2, 1,  'applied',    17, NULL, NULL),
  (2, 11, 'r1_cleared', 17, 1,    NULL),
  (2, 21, 'r2_cleared', 17, 2,    NULL),
  (2, 31, 'r3_cleared', 17, 3,    NULL),
  (2, 41, 'placed',     17, 3,    6.50),
  (2, 51, 'rejected',   17, 1,    NULL);

-- ============================================================================
-- 31. STUDENT PROJECT TEAMS  (covers project status/request status values)
-- ============================================================================
INSERT INTO project_teams (id, team_name, project_title, project_description, leader_student_id, class_id, batch_id, department_id, max_members, current_members, status) OVERRIDING SYSTEM VALUE VALUES
  (1, 'Team Innovate',   'Smart Attendance System using Face Recognition', 'Final year project using OpenCV and deep learning.', 1, 1, 1, 1, 5, 2, 'OPEN'),
  (2, 'Team DataMinds',  'Crop Yield Prediction using Machine Learning',   'AIDS final year project.',                            31, 4, 1, 2, 4, 3, 'CLOSED');

INSERT INTO project_team_members (team_id, student_id, role) VALUES
  (1, 1, 'LEADER'),
  (1, 2, 'MEMBER'),
  (2, 31, 'LEADER'),
  (2, 32, 'MEMBER'),
  (2, 33, 'MEMBER');

INSERT INTO project_recruitment_posts (team_id, title, description, vacancies, required_skills, deadline, status) VALUES
  (1, 'Looking for a backend developer', 'Need one more member skilled in Python/Flask for the API layer.', 3, ARRAY['Python','Flask','OpenCV'], CURRENT_DATE + 20, 'ACTIVE');

INSERT INTO project_join_requests (team_id, student_id, message, status) VALUES
  (1, 3, 'I have experience with Flask APIs, would like to join.', 'PENDING');

-- ============================================================================
-- 32. ON-DUTY (OD) REQUESTS  (covers od_verification_status_enum, approval_status_enum)
-- ============================================================================
INSERT INTO od_teams (id, created_by_student_id, unique_code, is_locked) OVERRIDING SYSTEM VALUE VALUES
  (1, 1, 'ODTEAM0001', true);

INSERT INTO od_team_members (team_id, student_id) VALUES
  (1, 1), (1, 2), (1, 3);

INSERT INTO od_requests (id, team_id, from_date, to_date, reason, mentor_approval_status, faculty_guide_id, organization, location, verification_status) OVERRIDING SYSTEM VALUE VALUES
  (1, 1, '2026-07-10', '2026-07-12', 'Participating in Smart India Hackathon', 'approved', 2, 'Smart India Hackathon', 'Chennai', 'verified');

INSERT INTO od_request_hod_approvals (od_request_id, student_id, department_id, hod_user_id, status, reviewed_at) VALUES
  (1, 1, 1, 28, 'approved', now() - interval '5 days'),
  (1, 2, 1, 28, 'approved', now() - interval '5 days'),
  (1, 3, 1, 28, 'pending',  NULL);

-- ============================================================================
-- 33. STUDENT PROFILE DATA  (addresses, family, sensitive info, profiles,
--     identity marks, wallets — a light sample, not all 130 students)
-- ============================================================================
INSERT INTO student_addresses (student_id, address_type, address_line, city, state, pincode)
SELECT id, 'permanent', 'Door No. ' || id || ', Gandhi Street', 'Coimbatore', 'Tamil Nadu', '641001' FROM students WHERE id <= 20;

INSERT INTO student_addresses (student_id, address_type, address_line, city, state, pincode)
SELECT id, 'temporary', 'Hostel Campus, SECE', 'Coimbatore', 'Tamil Nadu', '641107' FROM students WHERE student_type = 'hosteller' AND id <= 20;

INSERT INTO student_family_details (student_id, father_name, father_occupation, father_annual_income, mother_name, mother_occupation)
SELECT id, 'Guardian of ' || roll_no, 'Business', 480000.00, 'Spouse of Guardian of ' || roll_no, 'Homemaker'
FROM students WHERE id <= 10;

INSERT INTO student_sensitive_info (student_id, aadhar_number, pan_number)
SELECT id, lpad(id::text, 12, '9'), 'ABCDE' || lpad(id::text, 4, '0') || 'F' FROM students WHERE id <= 10;

INSERT INTO student_profiles (student_id, resume_url, linkedin_url, github_url, leetcode_url)
SELECT id, '/files/resumes/' || roll_no || '.pdf', 'https://linkedin.com/in/' || lower(roll_no), 'https://github.com/' || lower(roll_no), 'https://leetcode.com/' || lower(roll_no)
FROM students WHERE id <= 15;

INSERT INTO student_identity_marks (student_id, mark_number, description)
SELECT id, 1, 'Mole on left cheek' FROM students WHERE id <= 10;

-- Wallets are keyed by user_id now (any user can have one, not just
-- students), so every wallet here is created off students.user_id.
INSERT INTO wallets (user_id, balance, pin_hash, pin_set_at)
SELECT s.user_id, (500 + (s.id * 37) % 1500)::numeric,
  (CASE WHEN s.id % 4 = 0 THEN '1e9b38de300be8453122d0138c5854010c9dc0587c53ceab4d9bcd14db882816' END),
  (CASE WHEN s.id % 4 = 0 THEN now() END)
FROM students s WHERE s.id <= 30;

INSERT INTO wallet_outlets (id, name, outlet_type, location) OVERRIDING SYSTEM VALUE VALUES
  (1, 'Main Recharge Counter', 'recharge_counter', 'Admin Block'),
  (2, 'Campus Stationary Store', 'stationary',       'Block A Ground Floor'),
  (3, 'Xerox & Photocopy Shop', 'photocopier',        'Block B Ground Floor');

INSERT INTO wallet_transactions (wallet_id, txn_type, source, amount, status, processed_by_user_id, outlet_id, razorpay_order_id, razorpay_payment_id)
SELECT w.id, 'credit', 'razorpay', 1000.00, 'success', 19, 1, 'order_' || s.id, 'pay_' || s.id
FROM wallets w JOIN students s ON s.user_id = w.user_id WHERE s.id <= 10;

INSERT INTO wallet_transactions (wallet_id, txn_type, source, amount, status, processed_by_user_id, outlet_id)
SELECT w.id, 'debit', 'purchase', 50.00, 'success', NULL, 3
FROM wallets w JOIN students s ON s.user_id = w.user_id WHERE s.id BETWEEN 1 AND 5;

INSERT INTO wallet_transactions (wallet_id, txn_type, source, amount, status)
SELECT w.id, 'credit', 'cash', 500.00, 'pending'
FROM wallets w JOIN students s ON s.user_id = w.user_id WHERE s.id = 11;

INSERT INTO wallet_transactions (wallet_id, txn_type, source, amount, status)
SELECT w.id, 'debit', 'adjustment', 20.00, 'failed'
FROM wallets w JOIN students s ON s.user_id = w.user_id WHERE s.id = 12;

-- A wallet-to-wallet transfer (covers the 'transfer' source value and the
-- self-referential related_transaction_id / counterparty_wallet_id link):
-- a debit from student 1's wallet paired with the matching credit into
-- student 2's wallet.
WITH w1 AS (SELECT w.id FROM wallets w JOIN students s ON s.user_id = w.user_id WHERE s.id = 1),
     w2 AS (SELECT w.id FROM wallets w JOIN students s ON s.user_id = w.user_id WHERE s.id = 2),
     debit_txn AS (
       INSERT INTO wallet_transactions (wallet_id, txn_type, source, amount, status, counterparty_wallet_id)
       SELECT w1.id, 'debit', 'transfer', 100.00, 'success', w2.id FROM w1, w2
       RETURNING id, wallet_id
     )
INSERT INTO wallet_transactions (wallet_id, txn_type, source, amount, status, counterparty_wallet_id, related_transaction_id)
SELECT w2.id, 'credit', 'transfer', 100.00, 'success', debit_txn.wallet_id, debit_txn.id
FROM w2, debit_txn;

-- ============================================================================
-- 34. FEE DEMAND / PAYMENTS / CONCESSIONS  (covers payment_mode_enum, dd_status_enum)
-- ============================================================================
INSERT INTO student_fee_demand_mapping (student_id, fee_structure_id, academic_year, semester, total_amount, demand_category)
SELECT s.id, (CASE WHEN s.quota_id = 2 THEN 2 ELSE 1 END),
       s.joined_academic_year, 1, (CASE WHEN s.quota_id = 2 THEN 127000.00 ELSE 67000.00 END), 1
FROM students s WHERE s.id <= 20;

INSERT INTO fee_payments (student_fee_demand_mapping_id, amount_paid, payment_mode, receipt_no, is_partial, collected_by_user_id, fee_structure_item_id)
SELECT sfdm.id, 40000.00, 'upi', 'RCPT-' || lpad(sfdm.id::text, 5, '0'), true, 19, 1
FROM student_fee_demand_mapping sfdm WHERE sfdm.student_id <= 10;

INSERT INTO fee_payments (student_fee_demand_mapping_id, amount_paid, payment_mode, receipt_no, is_partial, collected_by_user_id, fee_structure_item_id)
SELECT sfdm.id, 27000.00, 'netbanking', 'RCPT-' || lpad((1000 + sfdm.id)::text, 5, '0'), false, 19, 1
FROM student_fee_demand_mapping sfdm WHERE sfdm.student_id BETWEEN 11 AND 15;

INSERT INTO fee_concessions (fee_structure_id, concession_amount, is_settled, settled_date) VALUES
  (1, 5000.00, true,  CURRENT_DATE - 30),
  (2, 10000.00, false, NULL);

INSERT INTO education_loan_dd (student_fee_demand_mapping_id, dd_reference_number, bank_name, amount, status, received_by_user_id)
SELECT sfdm.id, 'DD-' || lpad(sfdm.id::text, 6, '0'), 'State Bank of India', 60000.00, 'cleared', 19
FROM student_fee_demand_mapping sfdm WHERE sfdm.student_id = 16;

INSERT INTO education_loan_dd (student_fee_demand_mapping_id, dd_reference_number, bank_name, amount, status, received_by_user_id)
SELECT sfdm.id, 'DD-' || lpad(sfdm.id::text, 6, '0'), 'Canara Bank', 60000.00, 'bounced', 19
FROM student_fee_demand_mapping sfdm WHERE sfdm.student_id = 17;

-- ============================================================================
-- 35. FACULTY OPERATIONS  (leaves, OD, daily attendance, documents, payslips,
--     appraisal, salary — covers faculty_attendance_status_enum,
--     faculty_employment_status_enum/type already on faculty rows above)
-- ============================================================================
INSERT INTO faculty_leaves (faculty_id, from_date, to_date, reason, hod_approval_status, hr_approval_status) VALUES
  (2, '2026-07-20', '2026-07-21', 'Personal work',        'approved', 'approved'),
  (3, '2026-08-01', '2026-08-01', 'Medical',               'approved', 'pending'),
  (9, '2026-08-05', '2026-08-06', 'Family function',       'pending',  'pending'),
  (14,'2026-06-15', '2026-06-16', 'Conference attendance', 'rejected', 'rejected');

INSERT INTO faculty_od_requests (faculty_id, from_date, to_date, place, purpose, hod_approval_status, hr_approval_status, organization_visited, verification_status) VALUES
  (3, '2026-07-05', '2026-07-06', 'Anna University, Chennai', 'Attending FDP on AI in Education', 'approved', 'approved', 'Anna University', 'verified'),
  (9, '2026-07-15', '2026-07-15', 'PSG Tech, Coimbatore',     'Guest lecture invitation',          'approved', 'pending',  'PSG College of Technology', 'under_review');

INSERT INTO faculty_daily_attendance (faculty_id, attendance_date, punch_in, punch_out, status, academic_year)
SELECT f.id, d.dt,
  (CASE WHEN status_pick = 'full_day' THEN time '09:00' WHEN status_pick = 'half_day' THEN time '09:00' END),
  (CASE WHEN status_pick = 'full_day' THEN time '17:00' WHEN status_pick = 'half_day' THEN time '13:00' END),
  status_pick::faculty_attendance_status_enum,
  '2025-2026'
FROM faculty f
CROSS JOIN (VALUES (date '2026-08-03'), (date '2026-08-04'), (date '2026-08-05')) AS d(dt)
CROSS JOIN LATERAL (
  SELECT (ARRAY['full_day','full_day','full_day','half_day','on_leave','on_duty','absent'])[1 + ((f.id + extract(day from d.dt)::int) % 7)] AS status_pick
) p;

INSERT INTO faculty_documents (faculty_id, document_type, file_name, file_url, uploaded_by_user_id) VALUES
  (1, 'PhD Certificate', 'suresh_phd_cert.pdf', '/files/faculty-docs/suresh_phd_cert.pdf', 28),
  (2, 'Experience Certificate', 'arun_exp_cert.pdf', '/files/faculty-docs/arun_exp_cert.pdf', 28);

INSERT INTO faculty_id_card_issuances (faculty_id, issued_by_user_id) VALUES
  (2, 1), (3, 1), (8, 1), (13, 1);

INSERT INTO faculty_activity_log (faculty_id, description, created_by_user_id) VALUES
  (2, 'Conducted a guest lecture on Cloud Computing for final year students.', 28),
  (9, 'Published a research paper in an IEEE conference.', 34);

INSERT INTO faculty_sensitive_info (faculty_id, aadhar_number, pan_number, bank_account_number, bank_ifsc, bank_name) VALUES
  (1, '111122223333', 'ABCPK1234A', '1234567890123', 'SBIN0001234', 'State Bank of India'),
  (2, '222233334444', 'ABCPK5678B', '2234567890123', 'HDFC0001234', 'HDFC Bank');

INSERT INTO payslip_requests (faculty_id, month, year, status, purpose) VALUES
  (2, 7, 2026, 'processed', 'Bank loan document'),
  (9, 8, 2026, 'pending',   'Personal record'),
  (14,6, 2026, 'rejected',  'Visa application');

INSERT INTO appraisal_divisions (id, name) OVERRIDING SYSTEM VALUE VALUES
  (1, 'Teaching'),
  (2, 'Research & Publications'),
  (3, 'Institutional Contribution');

INSERT INTO appraisal_criteria (id, division_id, criteria_name, max_score, academic_year) OVERRIDING SYSTEM VALUE VALUES
  (1, 1, 'Student Feedback Score', 20, '2025-2026'),
  (2, 1, 'Course Completion',      10, '2025-2026'),
  (3, 2, 'Journal Publications',   30, '2025-2026'),
  (4, 3, 'Committee Participation',10, '2025-2026');

INSERT INTO appraisal_requests (id, faculty_id, academic_year, status, hod_reviewed_by, hod_reviewed_at, management_approved_by, management_approved_at) OVERRIDING SYSTEM VALUE VALUES
  (1, 2, '2025-2026', 'management_approved', 28, now() - interval '10 days', 2, now() - interval '2 days'),
  (2, 9, '2025-2026', 'hod_reviewed',        34, now() - interval '3 days',  NULL, NULL),
  (3, 14,'2025-2026', 'submitted',           NULL, NULL, NULL, NULL);

INSERT INTO appraisal_entries (appraisal_request_id, criteria_id, description, score) VALUES
  (1, 1, 'Consistently rated above 4.5/5', 19.00),
  (1, 3, 'Two Scopus indexed journal papers', 25.00),
  (2, 1, 'Good student feedback', 16.50);

INSERT INTO appraisal_attachments (appraisal_request_id, division_id, file_url, file_name, storage_path) VALUES
  (1, 2, '/files/appraisal/2-publications.pdf', 'publications.pdf', 'appraisal/2/publications.pdf');

INSERT INTO salary_divisions (faculty_id, division_name, amount, effective_from) VALUES
  (2, 'Basic Pay', 45000.00, '2025-06-01'),
  (2, 'HRA',       12000.00, '2025-06-01'),
  (9, 'Basic Pay', 40000.00, '2025-06-01');

INSERT INTO salary_payments (payee_type, faculty_id, staff_id, month, year, gross_amount, net_amount, paid_at, processed_by_user_id) VALUES
  ('faculty', 2, NULL, 7, 2026, 65000.00, 61000.00, now() - interval '10 days', 20),
  ('faculty', 9, NULL, 7, 2026, 58000.00, 54500.00, now() - interval '10 days', 20),
  ('staff',   NULL, 1, 7, 2026, 22000.00, 21000.00, now() - interval '10 days', 20);

-- ============================================================================
-- 36. HOSTEL OPERATIONS  (covers hostel_complaint_*, hostel_quit_fee_status_enum,
--     entry_type_enum)
-- ============================================================================
INSERT INTO hostel_settings (updated_at) VALUES (now());

INSERT INTO hostel_complaints (student_id, hostel_id, category, title, description, priority, status, assigned_to, resolution_note, resolved_at)
SELECT student_id, 1, 'plumbing', 'Leaking tap in washroom', 'The washroom tap on the 2nd floor is leaking continuously.', 'medium', 'resolved', 'Maintenance Team', 'Tap washer replaced.', now() - interval '2 days'
FROM student_hostel_mapping LIMIT 1;

INSERT INTO hostel_complaints (student_id, hostel_id, category, title, description, priority, status)
SELECT student_id, 2, 'network', 'No WiFi in room', 'WiFi signal is very weak in room A-F3.', 'high', 'in_progress'
FROM student_hostel_mapping shm JOIN students s ON s.id = shm.student_id WHERE s.gender = 'Female' LIMIT 1;

INSERT INTO hostel_mess_feedback (student_id, hostel_id, rating, comment)
SELECT student_id, 1, 4, 'Food quality has improved this month.' FROM student_hostel_mapping LIMIT 1;

INSERT INTO hostel_outings (student_id, start_time, return_time, reason, from_date, to_date, status, approved_by_warden_user_id)
SELECT student_id, time '10:00', time '18:00', 'Visiting home for a family function', CURRENT_DATE, CURRENT_DATE, 'approved', 189
FROM student_hostel_mapping LIMIT 1;

INSERT INTO hostel_in_out_ledger (student_id, entry_type, recorded_by_user_id)
SELECT student_id, 'out', 189 FROM student_hostel_mapping LIMIT 1;
INSERT INTO hostel_in_out_ledger (student_id, entry_type, recorded_by_user_id)
SELECT student_id, 'in', 189 FROM student_hostel_mapping LIMIT 1;

INSERT INTO hostel_quit_requests (student_id, room_id, reason, fee_status, status)
SELECT shm.student_id, shm.room_id, 'Shifting to a day-scholar arrangement next semester.', 'pending', 'pending'
FROM student_hostel_mapping shm ORDER BY shm.id DESC LIMIT 1;

INSERT INTO hostel_goods (location, item, purpose, warden_id, block_id, received) VALUES
  ('A Block - Ground Floor', 'Water Purifier', 'Replacement for faulty unit', 1, 1, true),
  ('A Block - First Floor',  'Study Tables (x10)', 'New intake requirement', 2, 2, false);

-- ============================================================================
-- 37. MAIN GATE / VISITOR LOGS
-- ============================================================================
INSERT INTO main_gate_in_out_ledger (student_id, roll_no, entry_type, recorded_by_user_id, sms_sent_parent)
SELECT id, roll_no, 'out', 24, true FROM students WHERE id = 1;
INSERT INTO main_gate_in_out_ledger (student_id, roll_no, entry_type, recorded_by_user_id, sms_sent_parent)
SELECT id, roll_no, 'in', 24, true FROM students WHERE id = 1;

INSERT INTO visitor_logs (visitor_name, vehicle_number, member_count, reason, phone_number, recorded_by_user_id, exit_time) VALUES
  ('Ramasamy Naidu', 'TN-38-X-1122', 2, 'Meeting HOD regarding admission enquiry', '9876543210', 24, now() - interval '2 hours'),
  ('Book Vendor - Sri Books', 'TN-38-Y-5566', 1, 'Book delivery to library', '9876500000', 24, NULL);

-- ============================================================================
-- 38. PROCUREMENT  (covers indent_status_enum, proposal_status_enum,
--     bill_status_enum, vendor_type_enum)
-- ============================================================================
INSERT INTO vendors (id, name, contact_info, gst_no, company_name, item_name, item_price, phone, type) OVERRIDING SYSTEM VALUE VALUES
  (1, 'Sri Balaji Computers', 'contact@sribalaji.com', '33AAAAA0000A1Z5', 'Sri Balaji Computers Pvt Ltd', 'Desktop Computer', 45000.00, '9840011223', 'product'),
  (2, 'Annai Facility Services', 'info@annaifs.com',   '33BBBBB0000B1Z5', 'Annai Facility Services',    'Housekeeping Service', NULL, '9840022334', 'service');

INSERT INTO vendor_quotations (vendor_id, item_description, quoted_price) VALUES
  (1, '20 x Desktop Computers - i5, 8GB RAM', 900000.00),
  (2, 'Monthly housekeeping contract - Block A', 35000.00);

INSERT INTO expense_categories (id, name) OVERRIDING SYSTEM VALUE VALUES
  (1, 'Maintenance'),
  (2, 'Utilities'),
  (3, 'Stationery');

INSERT INTO expenses (category_id, description, amount, recorded_by_user_id) VALUES
  (1, 'AC repair - Seminar Hall', 4500.00, 21),
  (2, 'Electricity bill - July 2026', 185000.00, 21);

INSERT INTO purchase_indents (id, requested_by_user_id, department_id, item_name, quantity, purpose, status) OVERRIDING SYSTEM VALUE VALUES
  (1, 28, 1, 'Desktop Computers', 20, 'Lab upgrade for final year students', 'hod_approved'),
  (2, 34, 2, 'Whiteboard Markers', 100, 'Classroom consumables', 'submitted');

INSERT INTO purchase_order_proposals (id, indent_id, vendor_id, finance_reviewed_by, finance_reviewed_at, hod_reviewed_by, hod_reviewed_at, status) OVERRIDING SYSTEM VALUE VALUES
  (1, 1, 1, 21, now() - interval '5 days', 28, now() - interval '6 days', 'hod_approved');

INSERT INTO purchase_orders (id, proposal_id, po_number, approved_by_user_id, approved_at) OVERRIDING SYSTEM VALUE VALUES
  (1, 1, 'PO-2026-0001', 21, now() - interval '4 days');

INSERT INTO grn (purchase_order_id, quantity_received, issued_to_venue_id, issued_date, recorded_by_user_id) VALUES
  (1, 20, 1, CURRENT_DATE - 2, 21);

INSERT INTO bills (bill_number, purchase_order_id, vendor_id, quantity, unit_price, total_amount, status, created_by_user_id, paid_at) VALUES
  ('BILL-2026-0001', 1, 1, 20, 45000.00, 900000.00, 'paid', 21, now() - interval '1 day');

INSERT INTO service_indents (id, requested_by_user_id, department_id, service_description, title, status) OVERRIDING SYSTEM VALUE VALUES
  (1, 28, 1, 'Monthly housekeeping for the CSE block.', 'Block A Housekeeping', 'finance_approved');

INSERT INTO service_order_proposals (id, indent_id, vendor_id, finance_reviewed_by, finance_reviewed_at, status) OVERRIDING SYSTEM VALUE VALUES
  (1, 1, 2, 21, now() - interval '3 days', 'finance_approved');

INSERT INTO service_orders (id, proposal_id, so_number, approved_by_user_id, approved_at) OVERRIDING SYSTEM VALUE VALUES
  (1, 1, 'SO-2026-0001', 21, now() - interval '2 days');

INSERT INTO bills (bill_number, service_order_id, vendor_id, quantity, unit_price, total_amount, status) VALUES
  ('BILL-2026-0002', 1, 2, 1, 35000.00, 35000.00, 'pending');

-- ============================================================================
-- 39. SECRETARY REQUESTS  (covers secretary_request_status_enum)
-- ============================================================================
INSERT INTO secretary_product_requests (id, requested_by_user_id, title, justification, status, reviewed_by_user_id, reviewed_at) OVERRIDING SYSTEM VALUE VALUES
  (1, 28, 'New lab printers', 'Existing printers are out of service.', 'approved', 23, now() - interval '2 days');

INSERT INTO secretary_product_request_items (request_id, product_name, quantity, purpose) VALUES
  (1, 'HP LaserJet Printer', 2, 'Department office use');

INSERT INTO secretary_service_requests (id, requested_by_user_id, title, justification, status) OVERRIDING SYSTEM VALUE VALUES
  (1, 34, 'Network cabling for new lab', 'New AI lab needs structured cabling.', 'pending');

INSERT INTO secretary_service_request_items (request_id, service_name) VALUES
  (1, 'Structured Cabling Installation');

-- ============================================================================
-- 40. VENUE BOOKINGS & MEDIA REQUESTS  (covers venue_booking_status_enum)
-- ============================================================================
INSERT INTO venue_bookings (venue_id, booked_by_user_id, purpose, from_datetime, to_datetime, accommodating_strength, status, reviewed_by_user_id) VALUES
  (4, 28, 'Department Symposium', '2026-09-01 09:00+05:30', '2026-09-01 17:00+05:30', 300, 'approved', 3),
  (3, 34, 'Guest Lecture on AI Ethics', '2026-08-20 10:00+05:30', '2026-08-20 12:00+05:30', 150, 'pending', NULL);

INSERT INTO media_requests (requested_by_user_id, requested_by_faculty_id, description, status, event_name, event_date, venue_id, coordinator_name, contact_number, media_types) VALUES
  (28, 1, 'Photography and videography for department symposium.', 'approved', 'CSE Symposium 2026', '2026-09-01', 4, 'Suresh Kumar', '9840011111', ARRAY['photo','video']);

-- ============================================================================
-- 41. ALUMNI
-- ============================================================================
INSERT INTO alumni_batches (batch_id, group_name, graduated_on) VALUES
  (1, 'CSE / AIDS / ECE - Batch of 2026', '2026-06-30');

INSERT INTO alumni_members (alumni_batch_id, student_id, personal_email, current_company, designation, status)
SELECT ab.id, s.id, 'alumni.' || lower(s.roll_no) || '@gmail.com', 'TCS', 'Software Engineer', 'active'
FROM alumni_batches ab JOIN students s ON s.roll_no = '22CS001';

INSERT INTO alumni_announcements (posted_by_user_id, title, content) VALUES
  (27, 'Alumni Meet 2026', 'Join us for the annual alumni meet on campus this December.');

INSERT INTO alumni_group_messages (alumni_batch_id, posted_by_alumni_member_id, content)
SELECT ab.id, am.id, 'Looking forward to catching up with everyone at the alumni meet!'
FROM alumni_batches ab JOIN alumni_members am ON am.alumni_batch_id = ab.id;

-- ============================================================================
-- 42. COE PROFILE / DEPARTMENT ACHIEVEMENTS
-- ============================================================================
INSERT INTO coe_profiles (user_id, is_senior) VALUES (16, true);

INSERT INTO department_achievements (id, department_id, posted_by_user_id, title, description, achievement_date) OVERRIDING SYSTEM VALUE VALUES
  (1, 1, 28, 'Best Paper Award at ICCV 2026', 'A CSE faculty team won the best paper award at the International Conference on Computer Vision.', '2026-06-15'),
  (2, 2, 34, 'AIDS Students Win National Hackathon', 'A team of final year AIDS students won first place at Smart India Hackathon.', '2026-07-12');

INSERT INTO achievement_comments (achievement_id, commented_by_user_id, comment_text) VALUES
  (1, 3, 'Excellent achievement, proud of the team!'),
  (2, 28, 'Great work by the AIDS department students.');

INSERT INTO achievement_media (achievement_id, media_type, media_url, sequence_no) VALUES
  (1, 'photo', '/files/achievements/iccv-award.jpg', 1),
  (2, 'photo', '/files/achievements/hackathon-win.jpg', 1);

-- ============================================================================
-- 43. SOA (STUDENT ONLINE APPLICATION)  (covers soa_status_enum)
-- ============================================================================
INSERT INTO soa_applications (id, first_name, last_name, father_name, parent_contact, student_contact, student_email, cutoff_physics, cutoff_chemistry, cutoff_maths, community, status) OVERRIDING SYSTEM VALUE VALUES
  (1, 'Ajay',  'Krishnan', 'Krishnan Moorthy', '9840099001', '9840099002', 'ajay.applicant1@gmail.com', 92.00, 88.50, 95.00, 'OC', 'admission_confirmed'),
  (2, 'Nithya','Ramesh',   'Ramesh Babu',      '9840099003', '9840099004', 'nithya.applicant2@gmail.com', 85.00, 80.00, 90.00, 'BC', 'fees_paid'),
  (3, 'Karan', 'Mehta',    'Suresh Mehta',     '9840099005', '9840099006', 'karan.applicant3@gmail.com', 78.00, 75.00, 82.00, 'OC', 'applied'),
  (4, 'Fathima','Rahman',  'Abdul Rahman',     '9840099007', '9840099008', 'fathima.applicant4@gmail.com', 70.00, 68.00, 74.00, 'MBC', 'cancelled');

-- ============================================================================
-- 44. EXAM TIMETABLE VERSIONS / HALL PLANS / SEATING / INVIGILATION
--     (a light, single worked example hung off the batch-1 semester-6
--     University exam — the one already fully results_published above)
-- ============================================================================
WITH target_exam AS (
  SELECT id FROM exams WHERE batch_id = 1 AND semester = 6 AND exam_type_id = 3 LIMIT 1
)
INSERT INTO exam_timetable_versions (exam_id, department_id, version_number, status, created_by_user_id, published_by_user_id, published_at)
SELECT id, NULL, 1, 'published', 16, 16, now() - interval '60 days' FROM target_exam;

WITH target_exam AS (
  SELECT id FROM exams WHERE batch_id = 1 AND semester = 6 AND exam_type_id = 3 LIMIT 1
), ver AS (
  SELECT etv.id AS version_id, etv.exam_id FROM exam_timetable_versions etv JOIN target_exam te ON te.id = etv.exam_id
)
INSERT INTO exam_timetable (exam_subject_mapping_id, exam_date, start_time, end_time, version_id, session, venue_id)
SELECT esm.id, CURRENT_DATE - 55 + ((ROW_NUMBER() OVER (ORDER BY esm.subject_id) - 1)::int),
  time '10:00', time '13:00', ver.version_id, 'FN', 1
FROM exam_subject_mapping esm
JOIN ver ON ver.exam_id = esm.exam_id
JOIN classes c ON c.id = esm.class_id AND c.section = 'A'
GROUP BY esm.id, esm.subject_id, ver.version_id;

WITH target_exam AS (
  SELECT id FROM exams WHERE batch_id = 1 AND semester = 6 AND exam_type_id = 3 LIMIT 1
)
INSERT INTO hall_plans (exam_id, venue_id, exam_date, capacity)
SELECT id, 1, CURRENT_DATE - 55, 120 FROM target_exam;

WITH target_exam AS (
  SELECT id FROM exams WHERE batch_id = 1 AND semester = 6 AND exam_type_id = 3 LIMIT 1
)
INSERT INTO seating_plan_versions (exam_id, exam_date, session, version_number, status, created_by_user_id, published_by_user_id, published_at)
SELECT id, CURRENT_DATE - 55, 'FN', 1, 'published', 16, 16, now() - interval '56 days' FROM target_exam;

INSERT INTO seating_plan_version_venues (version_id, venue_id, hall_plan_id, allocation_mode, pattern)
SELECT spv.id, 1, hp.id, 'automatic', 'alternate_seat'
FROM seating_plan_versions spv
JOIN hall_plans hp ON hp.exam_id = spv.exam_id;

INSERT INTO seating_plan_venue_departments (version_venue_id, department_id)
SELECT spvv.id, d.id
FROM seating_plan_version_venues spvv
CROSS JOIN departments d;

INSERT INTO seating_arrangements (hall_plan_id, student_id, seat_number, version_id)
SELECT hp.id, s.id, 'S' || lpad(ROW_NUMBER() OVER (ORDER BY s.id)::text, 3, '0'), spv.id
FROM hall_plans hp
JOIN seating_plan_versions spv ON spv.exam_id = hp.exam_id
JOIN classes c ON c.batch_id = 1 AND c.section = 'A'
JOIN students s ON s.class_id = c.id;

WITH target_exam AS (
  SELECT id, batch_id FROM exams WHERE batch_id = 1 AND semester = 6 AND exam_type_id = 3 LIMIT 1
)
INSERT INTO invigilation_allocation_batches (exam_id, exam_date, session, status, created_by_user_id, published_by_user_id, published_at)
SELECT id, CURRENT_DATE - 55, 'FN', 'published', 16, 16, now() - interval '57 days' FROM target_exam;

INSERT INTO invigilation_duties (exam_id, faculty_id, hall_plan_id, duty_date, session, role, allocation_batch_id)
SELECT iab.exam_id, 4, hp.id, iab.exam_date, iab.session, 'chief', iab.id
FROM invigilation_allocation_batches iab JOIN hall_plans hp ON hp.exam_id = iab.exam_id;

INSERT INTO invigilation_duties (exam_id, faculty_id, hall_plan_id, duty_date, session, role, allocation_batch_id)
SELECT iab.exam_id, 5, hp.id, iab.exam_date, iab.session, 'relief', iab.id
FROM invigilation_allocation_batches iab JOIN hall_plans hp ON hp.exam_id = iab.exam_id;

-- ============================================================================
-- 45. MALPRACTICE / REVALUATION / PHOTOCOPY  (covers malpractice_nature_enum,
--     malpractice_action_enum, revaluation_status_enum, photocopy_status_enum)
-- ============================================================================
WITH pick AS (
  SELECT esm.id AS esm_id, esm.exam_id, esm.class_id, s.id AS student_id
  FROM exam_subject_mapping esm
  JOIN exams e ON e.id = esm.exam_id AND e.batch_id = 1 AND e.semester = 6 AND e.exam_type_id = 3
  JOIN classes c ON c.id = esm.class_id AND c.section = 'A'
  JOIN students s ON s.class_id = c.id
  ORDER BY esm.id, s.id LIMIT 1
)
INSERT INTO malpractice_incidents (student_id, exam_id, exam_subject_mapping_id, venue_id, incident_date, session, seat_number, nature, action_taken, invigilator_remarks, reported_by_faculty_id, recorded_by_user_id)
SELECT student_id, exam_id, esm_id, 1, CURRENT_DATE - 55, 'FN', 'S001', 'copying', 'warning_issued', 'Student found referring to a small chit of paper.', 4, 16 FROM pick;

WITH pick AS (
  SELECT esm.id AS esm_id, esm.exam_id, s.id AS student_id
  FROM exam_subject_mapping esm
  JOIN exams e ON e.id = esm.exam_id AND e.batch_id = 1 AND e.semester = 6 AND e.exam_type_id = 3
  JOIN classes c ON c.id = esm.class_id AND c.section = 'B'
  JOIN students s ON s.class_id = c.id
  ORDER BY esm.id, s.id LIMIT 1
)
INSERT INTO malpractice_incidents (student_id, exam_id, exam_subject_mapping_id, venue_id, incident_date, session, seat_number, nature, action_taken, invigilator_remarks, reported_by_faculty_id, recorded_by_user_id)
SELECT student_id, exam_id, esm_id, 1, CURRENT_DATE - 55, 'FN', 'S045', 'mobile_device', 'paper_cancelled', 'Mobile phone found in possession during the exam.', 5, 16 FROM pick;

WITH target_exam AS (
  SELECT id FROM exams WHERE batch_id = 1 AND semester = 6 AND exam_type_id = 3 LIMIT 1
)
INSERT INTO revaluation_windows (exam_id, application_type, is_open, opens_at, closes_at, fee_per_paper, photocopy_fee_per_paper, max_papers_per_student, created_by_user_id)
SELECT id, 'photocopy_and_reval', false, now() - interval '40 days', now() - interval '30 days', 500.00, 100.00, 3, 16 FROM target_exam;

INSERT INTO revaluation_requests (exam_marks_id, student_id, status, revised_marks, subject_id, exam_id, evaluator_faculty_id, fee_amount, fee_paid, remarks)
SELECT em.id, em.student_id, 'approved', em.marks_obtained + 4, esm.subject_id, esm.exam_id, 2, 500.00, true, 'Revaluation increased marks by 4.'
FROM exam_marks em
JOIN exam_subject_mapping esm ON esm.id = em.exam_subject_mapping_id
JOIN exams e ON e.id = esm.exam_id AND e.batch_id = 1 AND e.semester = 6 AND e.exam_type_id = 3
WHERE em.is_absent = false
ORDER BY em.id LIMIT 1;

INSERT INTO photocopy_requests (student_id, exam_marks_id, fee_amount, status, processed_by_user_id, processed_at)
SELECT em.student_id, em.id, 100.00, 'issued', 16, now() - interval '25 days'
FROM exam_marks em
JOIN exam_subject_mapping esm ON esm.id = em.exam_subject_mapping_id
JOIN exams e ON e.id = esm.exam_id AND e.batch_id = 1 AND e.semester = 6 AND e.exam_type_id = 3
WHERE em.is_absent = false
ORDER BY em.id DESC LIMIT 1;

-- ============================================================================
-- 46. ATTENDANCE  (last 5 working days for every student, covers
--     attendance_status_enum: present / absent / on_duty)
-- ============================================================================
INSERT INTO attendance_records (student_id, class_id, subject_id, attendance_date, status, marked_by_faculty_id, marked_by_user_id)
SELECT st.id, st.class_id, NULL, d.dt,
  (CASE WHEN (st.id + extract(day FROM d.dt)::int) % 11 = 0 THEN 'on_duty'
        WHEN (st.id + extract(day FROM d.dt)::int) % 7  = 0 THEN 'absent'
        ELSE 'present' END)::attendance_status_enum,
  cm.faculty_id, f.user_id
FROM students st
JOIN class_mentors cm ON cm.class_id = st.class_id
JOIN faculty f ON f.id = cm.faculty_id
CROSS JOIN (VALUES (date '2026-08-03'), (date '2026-08-04'), (date '2026-08-05'), (date '2026-08-06'), (date '2026-08-07')) AS d(dt);

-- ============================================================================
-- 47. HALL TICKET CLEARANCE EXCEPTIONS  (covers clearance_type_enum,
--     clearance_exception_status_enum)
-- ============================================================================
WITH target_exam AS (
  SELECT id FROM exams WHERE batch_id = 1 AND semester = 6 AND exam_type_id = 3 LIMIT 1
)
INSERT INTO hall_ticket_clearance_exceptions (student_id, exam_id, clearance_type, reason, status, reviewed_by_hod_user_id, reviewed_at, valid_until)
SELECT 2, id, 'library_due', 'Library fine pending clearance, HOD approved provisional hall ticket.', 'approved', 28, now() - interval '50 days', CURRENT_DATE + 30
FROM target_exam;

WITH target_exam AS (
  SELECT id FROM exams WHERE batch_id = 1 AND semester = 6 AND exam_type_id = 3 LIMIT 1
)
INSERT INTO hall_ticket_clearance_exceptions (student_id, exam_id, clearance_type, reason, status)
SELECT 3, id, 'fee_due', 'Fee arrears pending, exception requested.', 'pending'
FROM target_exam;

-- ============================================================================
-- 48. STUDENT LEAVES  (covers student_leave_status_enum)
-- ============================================================================
INSERT INTO student_leaves (student_id, from_date, to_date, reason, status, approved_by_faculty_id, approved_by_hod_user_id) VALUES
  (1,  '2026-07-14', '2026-07-14', 'Fever, medical rest advised.',   'hod_approved',     2, 28),
  (11, '2026-07-20', '2026-07-21', 'Family function.',               'faculty_approved', 5, NULL),
  (21, '2026-08-01', '2026-08-01', 'Personal work.',                 'pending',          NULL, NULL),
  (31, '2026-06-10', '2026-06-11', 'Not feeling well.',               'rejected',         8, NULL);

-- ============================================================================
-- 49. STUDENT PROJECTS  (individual/mentor-guided mini-projects, distinct
--     from the team-based project_teams module seeded above)
-- ============================================================================
INSERT INTO student_projects (student_id, title, description, mentor_faculty_id) VALUES
  (1,  'IoT based Smart Irrigation System', 'A mini-project on soil-moisture based automated irrigation.', 2),
  (31, 'Fake News Detection using NLP',     'A mini-project applying NLP classifiers to detect fake news.', 8),
  (61, 'Home Automation using Bluetooth',   'A mini-project on Bluetooth-controlled home appliances.',      13);

-- ============================================================================
-- 50. NEWER PROFILE TABLES  (personal_calendar_entries covers
--     personal_calendar_entry_category_enum; entrepreneurship / higher
--     education / social links are one-off student & user profile add-ons)
-- ============================================================================
INSERT INTO personal_calendar_entries (user_id, entry_date, title, category, details) VALUES
  (44, CURRENT_DATE + 3,  'Submit assignment 1',        'reminder', 'CS101 assignment deadline.'),
  (44, CURRENT_DATE + 10, 'Meet project mentor',         'meeting',  'Discuss Smart Attendance System progress.'),
  (29, CURRENT_DATE + 5,  'Doctor appointment',          'personal', NULL);

INSERT INTO student_entrepreneurship (student_id, business_name, business_description, sector, stage, funding_required, remarks) VALUES
  (2, 'CampusEats', 'A food delivery app exclusively for college campuses.', 'FoodTech', 'Idea', 200000.00, 'Participated in college incubation cell pitch.');

INSERT INTO student_higher_education (student_id, preferred_course, preferred_country, preferred_university, remarks) VALUES
  (3, 'MS in Computer Science', 'USA', 'Georgia Institute of Technology', 'Planning to appear for GRE in the next cycle.'),
  (33, 'MS in Data Science',    'Germany', NULL, 'Exploring DAAD scholarship options.');

INSERT INTO user_social_links (user_id, title, url, display_order) VALUES
  (44, 'LinkedIn', 'https://linkedin.com/in/arjun-k-22cs001', 1),
  (44, 'GitHub',   'https://github.com/arjun-k-22cs001',      2),
  (28, 'LinkedIn', 'https://linkedin.com/in/suresh-kumar-cse', 1);

-- ============================================================================
-- 51. CLEANUP — drop the working objects created only to help build this
--     seed (nothing here is left behind after this file finishes running).
-- ============================================================================
DROP TABLE IF EXISTS _seed_students_tmp;
DROP TABLE IF EXISTS _seed_parent_tmp;
DROP TABLE IF EXISTS _seed_current_subjects_tmp;
DROP FUNCTION IF EXISTS _seed_academic_year(int, int);

-- ============================================================================
-- 52. RESYNC SEQUENCES  — every insert above uses explicit ids for tables
--     that are referenced elsewhere by FK, so each such sequence needs to be
--     moved past the highest id actually inserted. This loop does that for
--     every table in the schema, generically, so nothing is missed and
--     nothing needs to be revisited if this file is extended later.
-- ============================================================================
DO $$
DECLARE
  r RECORD;
  seq_name text;
BEGIN
  FOR r IN
    SELECT c.relname AS table_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind = 'r' AND n.nspname = 'public'
  LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = r.table_name AND column_name = 'id'
    ) THEN
      seq_name := pg_get_serial_sequence(quote_ident(r.table_name), 'id');
      IF seq_name IS NOT NULL THEN
        EXECUTE format(
          'SELECT setval(%L, COALESCE((SELECT MAX(id) FROM %I), 1), true)',
          seq_name, r.table_name
        );
      END IF;
    END IF;
  END LOOP;
END $$;

COMMIT;

-- ============================================================================
-- Done. Everything above ran in one transaction — either all of it lands or
-- none of it does.
--
-- Quick-login accounts (password EOS@test123 for all of them):
--   admin@eos.test, management@eos.test, principal@eos.test, hod@eos.test,
--   faculty@eos.test, student@eos.test, parent@eos.test, librarian@eos.test,
--   warden@eos.test, accountant@eos.test, placement_officer@eos.test,
--   transport_manager@eos.test, security@eos.test,
--   non_teaching_staff@eos.test, alumni_coordinator@eos.test, coe@eos.test,
--   placement@eos.test, library@eos.test, billing@eos.test,
--   hr_payroll@eos.test, finance@eos.test, iqac@eos.test,
--   secretary@eos.test, gate_warden@eos.test, media_room@eos.test,
--   academic_coordinator@eos.test, alumni@eos.test
--
-- Real-convention logins (same password):
--   HODs:      hod_cse@sece.ac.in / hod_aids@sece.ac.in / hod_ece@sece.ac.in
--   Faculty:   e.g. arun.p@sece.ac.in (see faculty table for the full list)
--   Students:  e.g. arjun.k2022cse@sece.ac.in (see students/users for the
--              full list — one per roll number, roll_no e.g. 22CS001)
-- ============================================================================
