-- Media Room sample seed data — run AFTER media_room_wave2.sql.
-- Safe to re-run: each block is guarded so it won't duplicate rows.
-- created_by_user_id 25 = media_room@eos.test (adjust if that id differs on your DB).

-- ── Media team ──────────────────────────────────────────────────────────────
INSERT INTO media_team_members (full_name, designation, email, phone, skills, status, joined_on, created_by_user_id)
SELECT * FROM (VALUES
  ('Arun Vignesh', 'Photographer', 'arun.vignesh@eos.test', '9840012345', 'Event photography, Portrait lighting', 'active', DATE '2024-06-03', 25),
  ('Meera Krishnan', 'Videographer', 'meera.krishnan@eos.test', '9840012346', 'Videography, Adobe Premiere editing', 'active', DATE '2024-02-14', 25),
  ('Karthik S', 'Social media executive', 'karthik.s@eos.test', '9840012347', 'Publishing calendar, Community management', 'active', DATE '2024-09-21', 25),
  ('Divya R', 'Graphic designer', 'divya.r@eos.test', '9840012348', 'Poster design, Branding, Canva/Figma', 'active', DATE '2023-11-05', 25),
  ('Naveen Kumar', 'Drone operator', 'naveen.kumar@eos.test', '9840012349', 'Aerial photography, DGCA-certified drone pilot', 'active', DATE '2025-01-10', 25)
) AS v(full_name, designation, email, phone, skills, status, joined_on, created_by_user_id)
WHERE NOT EXISTS (SELECT 1 FROM media_team_members m WHERE m.full_name = v.full_name);

-- ── Equipment register ───────────────────────────────────────────────────────
INSERT INTO media_equipment (asset_tag, name, category, serial_no, condition, purchased_on, invoice_value, warranty_till, created_by_user_id)
SELECT * FROM (VALUES
  ('MR-CAM-001', 'Canon EOS R6', 'camera', 'SN-CNR6-2201', 'good', DATE '2024-03-12', 185000.00, DATE '2027-03-12', 25),
  ('MR-CAM-002', 'Sony FX30 Cinema Camera', 'camera', 'SN-SFX30-0091', 'good', DATE '2024-07-20', 220000.00, DATE '2027-07-20', 25),
  ('MR-LEN-001', 'Canon RF 24-70mm f/2.8', 'lens', 'SN-RF2470-115', 'good', DATE '2024-03-12', 165000.00, DATE '2027-03-12', 25),
  ('MR-LEN-002', 'Sony 70-200mm f/2.8 GM', 'lens', 'SN-SG70200-044', 'fair', DATE '2023-08-05', 195000.00, DATE '2026-08-05', 25),
  ('MR-SUP-001', 'Manfrotto Tripod 546B', 'support', 'SN-MT546-330', 'good', DATE '2023-05-01', 22000.00, NULL, 25),
  ('MR-SUP-002', 'DJI RS3 Gimbal', 'support', 'SN-DJIRS3-278', 'good', DATE '2024-11-18', 42000.00, DATE '2026-11-18', 25),
  ('MR-AUD-001', 'Rode Wireless GO II', 'audio', 'SN-RWG2-509', 'good', DATE '2024-01-22', 28000.00, DATE '2026-01-22', 25),
  ('MR-LIG-001', 'Godox LED Panel Kit', 'lighting', 'SN-GDXLED-162', 'good', DATE '2023-09-14', 35000.00, NULL, 25),
  ('MR-AER-001', 'DJI Mavic 3 Drone', 'aerial', 'SN-DJIM3-701', 'good', DATE '2024-10-02', 168000.00, DATE '2026-10-02', 25)
) AS v(asset_tag, name, category, serial_no, condition, purchased_on, invoice_value, warranty_till, created_by_user_id)
WHERE NOT EXISTS (SELECT 1 FROM media_equipment e WHERE e.asset_tag = v.asset_tag);

-- ── Indents ──────────────────────────────────────────────────────────────────
INSERT INTO media_indents (requested_by_user_id, title, indent_type, quantity, estimated_cost, needed_by, budget_head, justification, status)
SELECT * FROM (VALUES
  (25, 'Two mirrorless bodies for event coverage', 'capital_equipment', 2, 370000.00, DATE '2026-10-15', 'media_branding', 'Current bodies are booked back-to-back during placement season; need a second crew capable of independent coverage.', 'pending'),
  (25, 'SD cards and spare batteries', 'consumables', 10, 18000.00, DATE '2026-09-05', 'institution_events', 'Running low on high-speed cards ahead of the cultural fest shoot schedule.', 'approved'),
  (25, 'Gimbal motor service', 'repair_service', 1, 6500.00, DATE '2026-09-01', 'media_branding', 'DJI RS3 showing pan-axis drift; needs authorised service before the next long-form shoot.', 'fulfilled'),
  (25, 'Drone hire for graduation day aerial coverage', 'rental_hire', 1, 12000.00, DATE '2026-11-20', 'institution_events', 'Our drone will be in for annual maintenance that week; hiring a backup unit for the day.', 'pending')
) AS v(requested_by_user_id, title, indent_type, quantity, estimated_cost, needed_by, budget_head, justification, status)
WHERE NOT EXISTS (SELECT 1 FROM media_indents i WHERE i.title = v.title);

-- ── Shoot assignment ─────────────────────────────────────────────────────────
-- Only one real *approved* media_requests row exists (id=1, "CSE Symposium
-- 2026") — a shoot can only attach to an approved/delivered request, so this
-- is the only one seeded here. Approve more requests via the Media Requests
-- page and add further shoot assignments the same way from the UI.
INSERT INTO media_shoot_assignments (media_request_id, assigned_to_member_id, crew, gear_issued, output_type, scheduled_at, status, created_by_user_id)
SELECT 1, m.id, 'Arun Vignesh, Meera Krishnan', 'Canon EOS R6, RF 24-70mm, Rode Wireless GO II', 'Photos + highlight reel', TIMESTAMPTZ '2026-09-01 10:00:00+05:30', 'planned', 25
FROM media_team_members m
WHERE m.full_name = 'Arun Vignesh'
  AND NOT EXISTS (SELECT 1 FROM media_shoot_assignments s WHERE s.media_request_id = 1);
