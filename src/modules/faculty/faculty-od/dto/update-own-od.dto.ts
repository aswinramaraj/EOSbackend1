import { IsDateString, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * PATCH /me/my-od/:id — self-edit for the requester's OWN, still-pending
 * (at HR Payroll) OD request. Distinct from UpdateFacultyOdDto (which only
 * ever sets the two approval-status fields for a reviewer).
 */
export class UpdateOwnOdDto {
  @IsOptional()
  @IsDateString({}, { message: 'from_date must be a valid ISO date' })
  from_date?: string;

  @IsOptional()
  @IsDateString({}, { message: 'to_date must be a valid ISO date' })
  to_date?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  place?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  purpose?: string;
}
