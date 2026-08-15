/**
 * All role names as they are stored in the `roles` table (name column).
 * Use these constants with the @Roles() decorator to guard routes.
 *
 * Example:
 *   @Roles(ROLES.ADMIN, ROLES.HOD)
 *   @UseGuards(JwtAuthGuard, RolesGuard)
 *   findAll() { ... }
 */
export const ROLES = {
  ADMIN: 'admin',
  PRINCIPAL: 'principal',
  HOD: 'hod',
  FACULTY: 'faculty',
  STUDENT: 'student',
  PARENT: 'parent',
  COE: 'coe',
  PLACEMENT: 'placement',
  LIBRARY: 'library',
  BILLING: 'billing',
  HR_PAYROLL: 'hr_payroll',
  FINANCE: 'finance',
  IQAC: 'iqac',
  SECRETARY: 'secretary',
  GATE_WARDEN: 'gate_warden',
  WARDEN: 'warden',
  MEDIA_ROOM: 'media_room',
  ACADEMIC_COORDINATOR: 'academic_coordinator',
  ALUMNI: 'alumni',
  /** Legacy role, id=14 in the real roles table — predates this repo's own 17-role seed, same situation as PRINCIPAL. 3 real users hold it. */
  NON_TEACHING_STAFF: 'non_teaching_staff',
  TRANSPORT: 'transport',
  HIGHER_EDUCATION: 'higheredu',
  MEDICAL_CENTRE: 'medical_centre',
  SPORTS_ADMIN: 'sports_admin',
} as const;

export type RoleKey = (typeof ROLES)[keyof typeof ROLES];
