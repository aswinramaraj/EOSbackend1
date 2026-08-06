export interface JwtPayload {
  /** users.id */
  sub: number;
  email: string;
  /** role name (e.g. 'admin', 'faculty') from the roles table */
  role: string;
  roleId: number;
  /** true only for `coe`-role users with coe_profiles.is_senior = true */
  isSeniorCoe?: boolean;
}
