-- Phase 7: Malpractice register
-- Brand-new table, zero existing data at risk.

BEGIN;

CREATE TYPE malpractice_nature_enum AS ENUM (
  'unauthorised_material', 'copying', 'mobile_device',
  'impersonation', 'misbehaviour_with_invigilator', 'answer_script_tampering'
);
CREATE TYPE malpractice_action_enum AS ENUM (
  'reported_to_coe', 'warning_issued', 'paper_cancelled',
  'semester_cancelled', 'debarred_one_year', 'case_under_enquiry'
);

CREATE TABLE malpractice_incidents (
  id                       SERIAL PRIMARY KEY,
  student_id               INTEGER NOT NULL REFERENCES students(id),
  exam_id                  INTEGER NOT NULL REFERENCES exams(id),
  exam_subject_mapping_id  INTEGER REFERENCES exam_subject_mapping(id),
  venue_id                 INTEGER REFERENCES venues(id),
  incident_date            DATE NOT NULL,
  session                  exam_session_enum NOT NULL,
  seat_number              VARCHAR(20),
  nature                   malpractice_nature_enum NOT NULL,
  action_taken             malpractice_action_enum NOT NULL,
  invigilator_remarks      VARCHAR(1000),
  reported_by_faculty_id   INTEGER REFERENCES faculty(id),
  recorded_by_user_id      INTEGER REFERENCES users(id),
  created_at               TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);

COMMIT;
