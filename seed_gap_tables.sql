--
-- seed_gap_tables.sql
-- ===========================================================================
-- Fills the 10 real tables that the main seed file
-- (seed_aiml_and_all_departments.sql) never covered. Verified against the
-- live database as the only genuinely-empty seedable tables after that run;
-- the remaining empties are app/runtime-populated only (model_performance,
-- training_examples, query_logs, attendance_record_changes,
-- admission_profile_drafts) plus _prisma_migrations (schema tracking).
--
-- Every foreign key is resolved by natural-key subquery, never a literal id,
-- and every insert is guarded with NOT EXISTS so a rerun is a no-op.
-- HARD RULE: the roles table is only ever read, never written.
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- program_outcomes: the 12 standard NBA / Washington-Accord graduate
-- attributes (PO1..PO12), one set per department.
-- ---------------------------------------------------------------------------
INSERT INTO program_outcomes (department_id, code, description)
SELECT d.id, p.code, p.description
FROM departments d
CROSS JOIN (VALUES
  ('PO1',  'Engineering knowledge: Apply knowledge of mathematics, science, engineering fundamentals and an engineering specialisation to the solution of complex engineering problems.'),
  ('PO2',  'Problem analysis: Identify, formulate, review research literature and analyse complex engineering problems, reaching substantiated conclusions using first principles of mathematics and engineering sciences.'),
  ('PO3',  'Design/development of solutions: Design solutions for complex engineering problems and design system components or processes meeting specified needs with due regard for public health, safety, society and the environment.'),
  ('PO4',  'Conduct investigations of complex problems: Use research-based knowledge and research methods including design of experiments, analysis and interpretation of data to provide valid conclusions.'),
  ('PO5',  'Modern tool usage: Create, select and apply appropriate techniques, resources and modern engineering and IT tools, including prediction and modelling, with an understanding of their limitations.'),
  ('PO6',  'The engineer and society: Apply reasoning informed by contextual knowledge to assess societal, health, safety, legal and cultural issues and the consequent responsibilities relevant to professional practice.'),
  ('PO7',  'Environment and sustainability: Understand the impact of professional engineering solutions in societal and environmental contexts and demonstrate the knowledge of and need for sustainable development.'),
  ('PO8',  'Ethics: Apply ethical principles and commit to professional ethics and responsibilities and norms of engineering practice.'),
  ('PO9',  'Individual and team work: Function effectively as an individual, and as a member or leader in diverse teams and in multidisciplinary settings.'),
  ('PO10', 'Communication: Communicate effectively on complex engineering activities, comprehend and write effective reports and design documentation, make presentations, and give and receive clear instructions.'),
  ('PO11', 'Project management and finance: Demonstrate knowledge and understanding of engineering and management principles and apply these to manage projects in multidisciplinary environments.'),
  ('PO12', 'Life-long learning: Recognise the need for, and have the preparation and ability to engage in independent and life-long learning in the broadest context of technological change.')
) AS p(code, description)
WHERE NOT EXISTS (
  SELECT 1 FROM program_outcomes po WHERE po.department_id = d.id AND po.code = p.code
);

-- ---------------------------------------------------------------------------
-- course_outcomes: CO1..CO5 for every real subject, phrased against the
-- subject's own name so each row is meaningful rather than boilerplate.
-- ---------------------------------------------------------------------------
INSERT INTO course_outcomes (subject_id, code, description)
SELECT s.id, c.code, c.prefix || s.name || c.suffix
FROM subjects s
CROSS JOIN (VALUES
  ('CO1', 'Recall and explain the fundamental concepts, terminology and principles of ', '.'),
  ('CO2', 'Apply the core techniques of ', ' to solve well-defined problems.'),
  ('CO3', 'Analyse practical scenarios in ', ' and select an appropriate method or model.'),
  ('CO4', 'Design and implement a solution or experiment relating to ', ' using modern tools.'),
  ('CO5', 'Evaluate outcomes in ', ' and communicate the findings clearly in a technical report.')
) AS c(code, prefix, suffix)
WHERE NOT EXISTS (
  SELECT 1 FROM course_outcomes co WHERE co.subject_id = s.id AND co.code = c.code
);

-- ---------------------------------------------------------------------------
-- outcome_attainments: NBA attainment records for the current academic year.
-- chk requires exactly one of course_outcome_id / program_outcome_id, matching
-- outcome_type. Target 2.80 on the standard 3-point NBA attainment scale.
-- Course-level: CO1..CO5 of every semester-1 subject of each department.
-- ---------------------------------------------------------------------------
INSERT INTO outcome_attainments
  (outcome_type, course_outcome_id, program_outcome_id, academic_year, batch_id,
   direct_value, indirect_value, target_value, attained_value, entered_by_user_id)
SELECT 'course', co.id, NULL, '2026-2027',
       (SELECT id FROM batches WHERE name = '2023-2027'),
       ROUND((2.30 + (co.id % 7) * 0.10)::numeric, 2),
       ROUND((2.50 + (co.id % 5) * 0.10)::numeric, 2),
       2.80,
       ROUND((2.35 + (co.id % 6) * 0.10)::numeric, 2),
       (SELECT id FROM users WHERE email = 'iqac@sece.ac.in')
FROM course_outcomes co
JOIN subjects s ON s.id = co.subject_id
WHERE s.semester = 1
  AND NOT EXISTS (
    SELECT 1 FROM outcome_attainments oa
    WHERE oa.course_outcome_id = co.id AND oa.academic_year = '2026-2027'
  );

-- Program-level: all 12 POs of every department.
INSERT INTO outcome_attainments
  (outcome_type, course_outcome_id, program_outcome_id, academic_year, batch_id,
   direct_value, indirect_value, target_value, attained_value, entered_by_user_id)
SELECT 'program', NULL, po.id, '2026-2027',
       (SELECT id FROM batches WHERE name = '2023-2027'),
       ROUND((2.40 + (po.id % 6) * 0.10)::numeric, 2),
       ROUND((2.55 + (po.id % 4) * 0.10)::numeric, 2),
       2.80,
       ROUND((2.45 + (po.id % 5) * 0.10)::numeric, 2),
       (SELECT id FROM users WHERE email = 'iqac@sece.ac.in')
FROM program_outcomes po
WHERE NOT EXISTS (
  SELECT 1 FROM outcome_attainments oa
  WHERE oa.program_outcome_id = po.id AND oa.academic_year = '2026-2027'
);

-- ---------------------------------------------------------------------------
-- user_roles: explicit user-to-role rows mirroring each user's users.role_id,
-- so the join table agrees with the denormalised column. roles is read only.
-- ---------------------------------------------------------------------------
INSERT INTO user_roles (user_id, role_id)
SELECT u.id, u.role_id
FROM users u
WHERE NOT EXISTS (
  SELECT 1 FROM user_roles ur WHERE ur.user_id = u.id AND ur.role_id = u.role_id
);

-- ---------------------------------------------------------------------------
-- social_post_details: presentation metadata for the seeded announcements
-- (announcement_id is the primary key, so one row per announcement).
-- ---------------------------------------------------------------------------
INSERT INTO social_post_details (announcement_id, format, link_url, expires_at, is_pinned, allow_comments)
SELECT a.id,
       CASE WHEN a.id % 3 = 0 THEN 'image' WHEN a.id % 3 = 1 THEN 'text' ELSE 'link' END,
       CASE WHEN a.id % 3 = 2 THEN 'https://www.sece.ac.in/announcements/' || a.id::text ELSE NULL END,
       '2026-12-31 23:59:59+05:30',
       (a.id % 4 = 0),
       TRUE
FROM announcements a
WHERE NOT EXISTS (SELECT 1 FROM social_post_details sp WHERE sp.announcement_id = a.id);

-- ---------------------------------------------------------------------------
-- announcement_comments: a short, realistic thread on each announcement -
-- one student question plus the posting staff member's reply to it.
-- ---------------------------------------------------------------------------
INSERT INTO announcement_comments (announcement_id, commented_by_user_id, comment_text, parent_comment_id)
SELECT a.id,
       (SELECT u.id FROM students st JOIN users u ON u.id = st.user_id
        WHERE st.status = 'active' ORDER BY st.id LIMIT 1 OFFSET (a.id % 20)),
       'Thank you for the update. Could you please confirm the exact venue and reporting time?',
       NULL
FROM announcements a
WHERE NOT EXISTS (
  SELECT 1 FROM announcement_comments ac
  WHERE ac.announcement_id = a.id AND ac.parent_comment_id IS NULL
);

INSERT INTO announcement_comments (announcement_id, commented_by_user_id, comment_text, parent_comment_id)
SELECT a.id,
       (SELECT id FROM users WHERE email = 'academiccoordinator@sece.ac.in'),
       'Venue and reporting time are as per the circular shared with your class advisor. Please check the notice board for the final schedule.',
       (SELECT ac.id FROM announcement_comments ac
        WHERE ac.announcement_id = a.id AND ac.parent_comment_id IS NULL
        ORDER BY ac.id LIMIT 1)
FROM announcements a
WHERE EXISTS (
    SELECT 1 FROM announcement_comments ac
    WHERE ac.announcement_id = a.id AND ac.parent_comment_id IS NULL
  )
  AND NOT EXISTS (
    SELECT 1 FROM announcement_comments ac
    WHERE ac.announcement_id = a.id AND ac.parent_comment_id IS NOT NULL
  );

-- ---------------------------------------------------------------------------
-- media_request_status_log: the real approval trail of each media request,
-- from submission through to its present status.
-- ---------------------------------------------------------------------------
INSERT INTO media_request_status_log (media_request_id, status, changed_at)
SELECT mr.id, v.status, v.changed_at::timestamptz
FROM media_requests mr
CROSS JOIN (VALUES
  ('submitted', '2026-08-28 10:15:00+05:30'),
  ('approved',  '2026-08-29 11:40:00+05:30')
) AS v(status, changed_at)
WHERE NOT EXISTS (
  SELECT 1 FROM media_request_status_log l
  WHERE l.media_request_id = mr.id AND l.status = v.status
);

-- ---------------------------------------------------------------------------
-- media_scorecard_targets: media-room KPI targets for the current year.
-- ---------------------------------------------------------------------------
INSERT INTO media_scorecard_targets (metric_key, academic_year, target_value, updated_by_user_id)
SELECT v.metric_key, '2026-2027', v.target_value,
       (SELECT id FROM users WHERE email = 'mediaroom@sece.ac.in')
FROM (VALUES
  ('events_covered',            60),
  ('photos_published',        2400),
  ('videos_published',          48),
  ('avg_turnaround_days',        3),
  ('social_media_posts',       180),
  ('equipment_utilisation_pct',  75)
) AS v(metric_key, target_value)
WHERE NOT EXISTS (
  SELECT 1 FROM media_scorecard_targets t
  WHERE t.metric_key = v.metric_key AND t.academic_year = '2026-2027'
);

-- ---------------------------------------------------------------------------
-- media_reports: periodic media-room reports.
-- ---------------------------------------------------------------------------
INSERT INTO media_reports (name, period, note, status, created_by_user_id)
SELECT v.name, v.period, v.note, v.status,
       (SELECT id FROM users WHERE email = 'mediaroom@sece.ac.in')
FROM (VALUES
  ('Media Coverage Summary - July 2026',      '2026-07', 'Covered 6 department events and 2 institutional functions; all deliverables published within the agreed turnaround.', 'published'),
  ('Media Coverage Summary - August 2026',    '2026-08', 'TechFest 2026 pre-event promotions and Independence Day coverage completed.',                                        'published'),
  ('Equipment Utilisation Report - Q1 2026',  '2026-Q1', 'Camera and lighting utilisation reviewed; one lens due for servicing.',                                              'draft'),
  ('Social Media Performance - August 2026',  '2026-08', 'Engagement up over the previous month, driven by placement announcements.',                                          'draft')
) AS v(name, period, note, status)
WHERE NOT EXISTS (SELECT 1 FROM media_reports r WHERE r.name = v.name);

-- ---------------------------------------------------------------------------
-- iqac_metric_targets: IQAC / NAAC-aligned institutional targets.
-- ---------------------------------------------------------------------------
INSERT INTO iqac_metric_targets (metric_key, academic_year, target_value, set_by_user_id)
SELECT v.metric_key, '2026-2027', v.target_value,
       (SELECT id FROM users WHERE email = 'iqac@sece.ac.in')
FROM (VALUES
  ('student_pass_percentage',        92.00),
  ('placement_percentage',           85.00),
  ('average_attendance_percentage',  90.00),
  ('faculty_publications_per_year', 120.00),
  ('feedback_response_rate',         80.00),
  ('co_attainment_target',            2.80),
  ('po_attainment_target',            2.80),
  ('higher_education_percentage',    12.00),
  ('faculty_doctorate_percentage',   65.00),
  ('student_faculty_ratio',          20.00)
) AS v(metric_key, target_value)
WHERE NOT EXISTS (
  SELECT 1 FROM iqac_metric_targets t
  WHERE t.metric_key = v.metric_key AND t.academic_year = '2026-2027'
);

COMMIT;
