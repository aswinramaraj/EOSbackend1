-- Lets hostel-resident faculty raise hostel complaints through the same
-- hostel_complaints table students already use (see
-- FacultyHostelComplaintsService / prisma/schema.prisma's hostel_complaints
-- model). student_id becomes nullable and a sibling faculty_id column is
-- added - application code enforces exactly one of the two is set per row.
ALTER TABLE hostel_complaints ALTER COLUMN student_id DROP NOT NULL;
ALTER TABLE hostel_complaints ADD COLUMN IF NOT EXISTS faculty_id INTEGER;
ALTER TABLE hostel_complaints
  ADD CONSTRAINT hostel_complaints_faculty_id_fkey
  FOREIGN KEY (faculty_id) REFERENCES faculty(id) ON DELETE NO ACTION ON UPDATE NO ACTION;
