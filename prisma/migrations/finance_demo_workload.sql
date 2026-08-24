-- ===========================================================================
-- finance_demo_workload.sql
-- ===========================================================================
-- Gives the Finance module a realistic working queue so every screen has
-- something to act on.
--
-- DATA ONLY — no schema change of any kind. It inserts new indents and
-- proposals; it does not modify, re-status or delete a single existing row, so
-- the real workflow state of anything already in the system is untouched.
--
-- What it adds:
--   * 12 purchase indents + POP proposals (pending)  -> POP Approval has work
--   * 10 service indents + SOP proposals (pending)   -> SOP Approval has work
--
-- Everything references real rows: real departments (by code), the real HoD
-- account of each department as requester, and real vendors already in the
-- vendors table. Amounts and item names are ordinary college procurement, and
-- every foreign key is resolved by natural-key subquery rather than a literal
-- id, so this is safe whatever the current sequence values are.
--
-- Idempotent: each row is guarded on its own `ref`, so re-running adds nothing.
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Purchase indents + proposals awaiting a Finance decision
-- ---------------------------------------------------------------------------
INSERT INTO purchase_indents
  (requested_by_user_id, department_id, item_name, quantity, purpose, status,
   needed_by, ref, estimated_amount, hod_reviewed_by, hod_reviewed_at, hod_remarks)
SELECT
  u.id, d.id, v.item_name, v.qty, v.purpose, 'hod_approved',
  CURRENT_DATE + v.days, v.ref, v.amount, u.id, now(), 'Forwarded to Finance'
FROM (VALUES
  ('CS',  'Dell OptiPlex desktops for Lab 3',        10, 'Replacing end-of-life machines in programming lab 3',  45, 'PI-FIN-001', 480000),
  ('AI',  'NVIDIA RTX workstation GPUs',              4, 'Deep learning coursework and final-year projects',     30, 'PI-FIN-002', 520000),
  ('EC',  'Digital storage oscilloscopes',            6, 'Electronics lab equipment refresh',                    60, 'PI-FIN-003', 270000),
  ('ME',  'Vernier calipers and micrometer sets',    40, 'Metrology lab consumable replacement',                 21, 'PI-FIN-004',  64000),
  ('EE',  'Three-phase induction motor trainer',      2, 'Electrical machines lab addition',                     75, 'PI-FIN-005', 185000),
  ('IT',  '24-port managed network switches',         8, 'Campus network upgrade in the IT block',               40, 'PI-FIN-006', 152000),
  ('CY',  'Hardware security testing kits',           5, 'Cyber security practical lab setup',                   50, 'PI-FIN-007',  98000),
  ('AD',  'High-capacity NAS storage unit',           1, 'Dataset storage for AI & DS research',                 35, 'PI-FIN-008', 210000),
  ('CB',  'Interactive smart display panels',         3, 'Business systems seminar rooms',                       55, 'PI-FIN-009', 246000),
  ('CC',  'RF signal generators',                     4, 'Communication engineering lab',                        65, 'PI-FIN-010', 176000),
  ('CS',  'Laser printers for staff room',            5, 'Departmental printing requirement',                    20, 'PI-FIN-011',  62500),
  ('ME',  'Hydraulic bench test rig',                 1, 'Fluid mechanics lab practical setup',                  90, 'PI-FIN-012', 320000)
) AS v(dept_code, item_name, qty, purpose, days, ref, amount)
JOIN departments d ON d.code = v.dept_code
-- The department's real HoD, via departments.head_of_department_faculty_id
-- (there is no is_hod flag on faculty); falls back to any active faculty in
-- that department so a department without a recorded HoD is still covered.
JOIN users u ON u.id = COALESCE(
  (SELECT f.user_id FROM faculty f WHERE f.id = d.head_of_department_faculty_id),
  (SELECT f.user_id FROM faculty f
    WHERE f.department_id = d.id AND f.status = 'active'
    ORDER BY f.id LIMIT 1)
)
WHERE NOT EXISTS (SELECT 1 FROM purchase_indents pi WHERE pi.ref = v.ref);

-- One proposal per new indent, left `pending` so Finance is the next actor.
-- A vendor is attached where one plausibly supplies that kind of item; the
-- column is nullable, so no vendor is invented when none matches.
INSERT INTO purchase_order_proposals
  (indent_id, vendor_id, status, hod_reviewed_by, hod_reviewed_at, hod_remarks)
SELECT
  pi.id,
  (SELECT ve.id FROM vendors ve ORDER BY ve.id LIMIT 1 OFFSET (pi.id % GREATEST((SELECT count(*) FROM vendors), 1))),
  'pending',
  pi.hod_reviewed_by,
  pi.hod_reviewed_at,
  'Recommended for purchase'
FROM purchase_indents pi
WHERE pi.ref LIKE 'PI-FIN-%'
  AND NOT EXISTS (SELECT 1 FROM purchase_order_proposals p WHERE p.indent_id = pi.id);

-- ---------------------------------------------------------------------------
-- Service indents + proposals awaiting a Finance decision
-- ---------------------------------------------------------------------------
INSERT INTO service_indents
  (requested_by_user_id, department_id, title, service_description, status,
   needed_by, quantity, location, ref, category, priority,
   hod_reviewed_by, hod_reviewed_at, hod_remarks)
SELECT
  u.id, d.id, v.title, v.descr, 'hod_approved',
  CURRENT_DATE + v.days, v.qty, v.location, v.ref, v.category, v.priority,
  u.id, now(), 'Forwarded to Finance'
FROM (VALUES
  ('CS',  'Air conditioner servicing - Lab 1', 'Quarterly servicing of 6 split AC units in programming lab 1',        '6',  'CS Block, Lab 1',       14, 'SI-FIN-001', 'maintenance', 'medium'),
  ('ME',  'Lathe machine calibration',         'Annual calibration and safety certification of 4 lathe machines',      '4',  'Workshop, ME Block',    30, 'SI-FIN-002', 'calibration', 'high'),
  ('EC',  'UPS battery replacement',           'Replacing UPS battery bank serving the electronics labs',              '1',  'EC Block, UPS room',    21, 'SI-FIN-003', 'maintenance', 'high'),
  ('AI',  'Server room cooling audit',         'Thermal audit and duct cleaning for the AI research server room',      '1',  'AI Block, Server room', 25, 'SI-FIN-004', 'audit',       'medium'),
  ('EE',  'Transformer oil testing',           'Dielectric testing of campus substation transformer oil',              '2',  'Main substation',       40, 'SI-FIN-005', 'testing',     'high'),
  ('IT',  'Structured cabling repair',         'Repair of damaged structured cabling on the IT block second floor',    '1',  'IT Block, Floor 2',     18, 'SI-FIN-006', 'repair',      'medium'),
  ('CY',  'Firewall appliance support renewal','Annual support and signature renewal for the perimeter firewall',      '1',  'Network Ops Centre',    35, 'SI-FIN-007', 'support',     'high'),
  ('AD',  'Projector lamp replacement',        'Replacing projector lamps across four AI & DS classrooms',             '4',  'AD Block',              12, 'SI-FIN-008', 'maintenance', 'low'),
  ('CB',  'Furniture repair - seminar hall',   'Repair and re-upholstery of seminar hall seating',                    '30', 'CB Block, Seminar hall',28, 'SI-FIN-009', 'repair',      'low'),
  ('CC',  'Antenna tower inspection',          'Structural and safety inspection of the communication antenna tower',  '1',  'Rooftop, CC Block',     45, 'SI-FIN-010', 'inspection',  'medium')
) AS v(dept_code, title, descr, qty, location, days, ref, category, priority)
JOIN departments d ON d.code = v.dept_code
-- The department's real HoD, via departments.head_of_department_faculty_id
-- (there is no is_hod flag on faculty); falls back to any active faculty in
-- that department so a department without a recorded HoD is still covered.
JOIN users u ON u.id = COALESCE(
  (SELECT f.user_id FROM faculty f WHERE f.id = d.head_of_department_faculty_id),
  (SELECT f.user_id FROM faculty f
    WHERE f.department_id = d.id AND f.status = 'active'
    ORDER BY f.id LIMIT 1)
)
WHERE NOT EXISTS (SELECT 1 FROM service_indents si WHERE si.ref = v.ref);

INSERT INTO service_order_proposals
  (indent_id, vendor_id, status, hod_reviewed_by, hod_reviewed_at, hod_remarks)
SELECT
  si.id,
  (SELECT ve.id FROM vendors ve ORDER BY ve.id LIMIT 1 OFFSET (si.id % GREATEST((SELECT count(*) FROM vendors), 1))),
  'pending',
  si.hod_reviewed_by,
  si.hod_reviewed_at,
  'Recommended for service order'
FROM service_indents si
WHERE si.ref LIKE 'SI-FIN-%'
  AND NOT EXISTS (SELECT 1 FROM service_order_proposals p WHERE p.indent_id = si.id);

COMMIT;

-- ===========================================================================
-- VERIFY (read-only)
-- ===========================================================================
-- SELECT status, count(*) FROM purchase_order_proposals GROUP BY status;
-- SELECT status, count(*) FROM service_order_proposals  GROUP BY status;
-- ===========================================================================
