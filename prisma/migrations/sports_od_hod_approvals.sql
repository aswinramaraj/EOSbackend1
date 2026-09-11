-- ============================================================================
--  Sports OD: approval by the HoD of every department in the squad
-- ============================================================================
--  A sports OD request covers one student or a whole squad, and those students
--  can come from several departments. The people entitled to approve the
--  absence are the HoDs of those departments -- not Sports itself, which is the
--  party raising the request.
--
--  This table fans one request out into one approval per department involved.
--  A squad of four students from AIDS, CSE, ECE and EEE therefore produces four
--  rows, one for each HoD; two students from the same department share a single
--  row, because the department only needs to decide once.
--
--  The parent request's own `status` becomes a roll-up of these rows:
--    any rejected -> rejected;  all approved -> approved;  otherwise pending.
--
--  `od_request_hod_approvals` already exists but is a foreign key onto
--  `od_requests` (the student-raised OD flow), so it cannot carry sports
--  requests. Hence a separate table rather than a reused one.
--
--  Safe to re-run.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS sports_od_hod_approvals (
  id                  serial       PRIMARY KEY,
  od_request_id       integer      NOT NULL
                                   REFERENCES sports_od_requests(id) ON DELETE CASCADE,
  department_id       integer      NOT NULL
                                   REFERENCES departments(id),
  -- Nullable: a department with no HoD on record still needs its approval row
  -- so the request cannot silently complete without that department agreeing.
  hod_user_id         integer      NULL REFERENCES users(id),
  status              approval_status_enum NOT NULL DEFAULT 'pending',
  reviewed_by_user_id integer      NULL REFERENCES users(id),
  reviewed_at         timestamptz  NULL,
  remarks             text         NULL,
  created_at          timestamptz  NOT NULL DEFAULT now(),

  -- One decision per department per request.
  CONSTRAINT sports_od_hod_approvals_request_department_key
    UNIQUE (od_request_id, department_id)
);

COMMENT ON TABLE sports_od_hod_approvals IS
  'One approval row per department represented in a sports OD squad. The HoD of that department is the approver; sports_od_requests.status is the roll-up.';

-- The HoD queue ("what is waiting for me?") filters on these two columns.
CREATE INDEX IF NOT EXISTS idx_sports_od_hod_approvals_hod_status
  ON sports_od_hod_approvals (hod_user_id, status);

-- Rolling up a request reads all of its rows.
CREATE INDEX IF NOT EXISTS idx_sports_od_hod_approvals_request
  ON sports_od_hod_approvals (od_request_id);

-- Department-wide queue for an HoD whose user link is not set yet.
CREATE INDEX IF NOT EXISTS idx_sports_od_hod_approvals_department_status
  ON sports_od_hod_approvals (department_id, status);

-- ─────────────────────────────────────────────────────────────────────────────
--  Backfill: requests raised before this table existed
-- ─────────────────────────────────────────────────────────────────────────────
--  A request with no approval rows can never be decided -- there is nobody the
--  roll-up can wait for -- so any still-pending request is fanned out now.
--
--  Restricted to status = 'pending' on purpose. Requests already approved or
--  rejected are finished; giving them fresh pending rows would make a closed
--  request look like it was waiting on departments again.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO sports_od_hod_approvals (od_request_id, department_id, hod_user_id)
SELECT DISTINCT r.id, c.department_id, f.user_id
FROM sports_od_requests r
JOIN sports_od_squad_members m ON m.od_request_id = r.id
JOIN students s                ON s.id = m.student_id
JOIN classes c                 ON c.id = s.class_id
LEFT JOIN departments d        ON d.id = c.department_id
LEFT JOIN faculty f            ON f.id = d.head_of_department_faculty_id
WHERE r.status = 'pending'
ON CONFLICT (od_request_id, department_id) DO NOTHING;

COMMIT;

-- ── verification ────────────────────────────────────────────────────────────
-- SELECT count(*) AS approval_rows FROM sports_od_hod_approvals;
-- SELECT r.id, r.event, r.status,
--        count(a.*)                                    AS departments,
--        count(*) FILTER (WHERE a.status = 'approved')  AS approved,
--        count(*) FILTER (WHERE a.status = 'rejected')  AS rejected
-- FROM sports_od_requests r
-- LEFT JOIN sports_od_hod_approvals a ON a.od_request_id = r.id
-- GROUP BY r.id, r.event, r.status
-- ORDER BY r.id DESC
-- LIMIT 20;
