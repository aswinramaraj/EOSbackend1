import { IsDateString, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * POST /me/create-od (Faculty only).
 *
 * `faculty_id` is never client-supplied - the service derives it from the
 * authenticated faculty (@CurrentUser().sub), same pattern as
 * CreateFacultyLeafDto (this is self-service OD application, not applying on
 * someone else's behalf).
 */
export class CreateFacultyOdDto {
  @IsDateString({}, { message: 'from_date must be a valid ISO date' })
  from_date: string;

  @IsDateString({}, { message: 'to_date must be a valid ISO date' })
  to_date: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  place?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  purpose?: string;
}
