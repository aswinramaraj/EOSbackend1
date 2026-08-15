import type { Prisma } from 'generated/prisma/client';

/**
 * Shared building blocks for every sports-admin sub-resource. A student's
 * display name is NOT on the `students` row itself — it lives on
 * `students.soa_applications.{first_name,last_name}` (the admission record),
 * same as principal-students.service.ts resolves it. Not every student has
 * a soa_applications row though (e.g. ones created outside the admission
 * funnel), so — again mirroring principal-students.service.ts's
 * `resolveName` — fall back to the account email rather than a literal
 * "Unknown" once soa_applications is null. Faculty rows do carry
 * first_name/last_name directly, no such fallback needed there.
 */

export const STUDENT_DISPLAY_INCLUDE = {
  soa_applications: { select: { first_name: true, last_name: true } },
  users: { select: { email: true } },
  student_contacts: {
    select: { student_mobile: true, student_email1: true },
  },
  classes: { select: { section: true, current_semester: true } },
  courses: {
    select: {
      name: true,
      code: true,
      departments: { select: { id: true, name: true, code: true } },
    },
  },
  batches: { select: { name: true } },
} satisfies Prisma.studentsInclude;

export type StudentWithDisplay = Prisma.studentsGetPayload<{
  include: typeof STUDENT_DISPLAY_INCLUDE;
}>;

export function resolveStudentName(student: {
  soa_applications: { first_name: string; last_name: string | null } | null;
  users: { email: string };
}): string {
  const soa = student.soa_applications;
  if (!soa || !soa.first_name) return student.users.email;
  return soa.last_name ? `${soa.first_name} ${soa.last_name}` : soa.first_name;
}

/** "MECH Sem 5 · MECH-A" style summary used across athlete/trial rows. */
export function studentAcademicMeta(student: StudentWithDisplay): string {
  const dept =
    student.courses?.departments?.code ?? student.courses?.code ?? '';
  const sem = student.classes?.current_semester
    ? `Sem ${student.classes.current_semester}`
    : '';
  const section = student.classes?.section
    ? `${student.courses?.departments?.code ?? ''}-${student.classes.section}`
    : '';
  return [dept, sem, section].filter(Boolean).join(' · ');
}

const ROMAN_YEARS = ['I', 'II', 'III', 'IV', 'V', 'VI'];

/** No literal "year of study" column exists anywhere — derived the same way principal-students / principal-finance do (2 semesters per year). */
export function romanYear(semester: number | null | undefined): string | null {
  if (!semester) return null;
  const year = Math.ceil(semester / 2);
  return ROMAN_YEARS[year - 1] ?? String(year);
}

/** "III Year · Sem 5" summary used in the athletes/trials list filters. */
export function yearSemLabel(
  semester: number | null | undefined,
): string | null {
  const roman = romanYear(semester);
  return roman ? `${roman} Year · Sem ${semester}` : null;
}

/** A `@db.Time` column comes back from Prisma as a Date anchored to the 1970-01-01 epoch — this reads back just the "HH:mm" time-of-day, in UTC (how it was written), never through a local-timezone getter. */
export function formatHHMM(time: Date | null): string | null {
  return time ? time.toISOString().slice(11, 16) : null;
}

export const FACULTY_DISPLAY_SELECT = {
  id: true,
  first_name: true,
  last_name: true,
  designation: true,
  specialization: true,
  qualification: true,
  previous_experience_years: true,
  date_of_joining: true,
  gender: true,
  date_of_birth: true,
  status: true,
  users: { select: { id: true, email: true, phone: true } },
} satisfies Prisma.facultySelect;

export type FacultyWithDisplay = Prisma.facultyGetPayload<{
  select: typeof FACULTY_DISPLAY_SELECT;
}>;

export function resolveFacultyName(faculty: {
  first_name: string;
  last_name: string;
}): string {
  return `${faculty.first_name} ${faculty.last_name}`;
}

/** Standard internal-error envelope — matches every other module in this codebase. */
export const INTERNAL_ERROR = {
  message: 'Something went wrong. Please try again.',
  errorCode: 'INTERNAL_ERROR',
} as const;
