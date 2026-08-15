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
  TRANSPORT: 'transport',
  HIGHER_EDUCATION: 'higheredu',
  MEDICAL_CENTRE: 'medical_centre',
} as const;

export type RoleKey = (typeof ROLES)[keyof typeof ROLES];
