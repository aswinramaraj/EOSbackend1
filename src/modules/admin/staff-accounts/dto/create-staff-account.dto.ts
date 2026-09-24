import {
  IsEmail,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  ValidateIf,
} from 'class-validator';
import { ROLES } from 'src/common/constants/roles.constant';
import {
  PROVISIONABLE_STAFF_ROLES,
  ProvisionableStaffRole,
} from '../constants/provisionable-roles.constant';

/**
 * POST /staff-accounts (Admin/HR Payroll).
 * Creates the login (`users` row) for any of the roles that have no
 * dedicated creation flow of their own. Secretary additionally creates a
 * `non_teaching_staff` row so department-scoped services can resolve it.
 * A temporary password is generated server-side and returned once.
 */
export class CreateStaffAccountDto {
  @IsEmail({}, { message: 'Please provide a valid email address' })
  email: string;

  @IsOptional()
  @IsString()
  @Matches(/^[0-9+\-\s()]{7,20}$/, {
    message: 'Please provide a valid phone number',
  })
  phone?: string;

  @IsIn(PROVISIONABLE_STAFF_ROLES, {
    message: 'That role cannot be provisioned here',
  })
  role_name: ProvisionableStaffRole;

  @ValidateIf((dto: CreateStaffAccountDto) => dto.role_name === ROLES.SECRETARY)
  @IsString()
  @IsNotEmpty({ message: 'Name is required for a Secretary account' })
  first_name?: string;

  @IsOptional()
  @IsString()
  last_name?: string;

  @ValidateIf((dto: CreateStaffAccountDto) => dto.role_name === ROLES.SECRETARY)
  @IsInt({ message: 'Department is required for a Secretary account' })
  department_id?: number;
}
