import { ROLES } from 'src/common/constants/roles.constant';

/**
 * Roles this module is allowed to create a login for. Deliberately excludes:
 *  - admin/principal/hod/faculty/student — each has its own dedicated
 *    creation flow elsewhere (Faculty/Student wizards, HoD appointment).
 *  - parent — tied to an existing student record, not a freestanding
 *    account; needs its own linking flow, not this generic form.
 *  - alumni — created by graduating an existing student (Finding 4), never
 *    provisioned directly.
 * Every role here needs nothing but a `users` row except SECRETARY, which
 * also needs a `non_teaching_staff` row for department scoping — see
 * StaffAccountsService.create().
 */
export const PROVISIONABLE_STAFF_ROLES = [
  ROLES.COE,
  ROLES.PLACEMENT,
  ROLES.LIBRARY,
  ROLES.BILLING,
  ROLES.HR_PAYROLL,
  ROLES.FINANCE,
  ROLES.IQAC,
  ROLES.SECRETARY,
  ROLES.GATE_WARDEN,
  ROLES.WARDEN,
  ROLES.MEDIA_ROOM,
  ROLES.ACADEMIC_COORDINATOR,
  ROLES.NON_TEACHING_STAFF,
  ROLES.TRANSPORT,
  ROLES.HIGHER_EDUCATION,
  ROLES.MEDICAL_CENTRE,
  ROLES.SPORTS_ADMIN,
  ROLES.EDC_COORDINATOR,
  ROLES.CANTEEN_ADMIN,
  ROLES.CANTEEN_CASHIER,
] as const;

export type ProvisionableStaffRole = (typeof PROVISIONABLE_STAFF_ROLES)[number];
