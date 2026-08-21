import { IsDateString, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * PATCH /me/my-leaves/:id — self-edit for the requester's OWN, still-
 * pending (at HR Payroll) leave request. Distinct from UpdateFacultyLeafDto
 * (which only ever sets the two approval-status fields for a reviewer) —
 * this only ever touches the requester's own from_date/to_date/reason.
 */
export class UpdateOwnLeaveDto {
  @IsOptional()
  @IsDateString({}, { message: 'from_date must be a valid ISO date' })
  from_date?: string;

  @IsOptional()
  @IsDateString({}, { message: 'to_date must be a valid ISO date' })
  to_date?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  reason?: string;
}
