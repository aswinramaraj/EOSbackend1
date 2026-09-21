-- faculty.dayscholar_mode was added to schema.prisma but never applied to the
-- database - resolveFacultyByUserId (used by HOD department-classes,
-- department-students, faculty-od, student-ods) queries it and 500s without
-- this column. Matches the existing dayscholar_mode_enum already used by
-- students.dayscholar_mode.
ALTER TABLE faculty ADD COLUMN IF NOT EXISTS dayscholar_mode dayscholar_mode_enum;
