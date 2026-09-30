import { IsEmail, IsIn, IsOptional, IsString, Matches } from 'class-validator';

const RELATIONSHIPS = ['father', 'mother', 'guardian'] as const;

/** POST /students/:id/parents (Admin). Creates a new parent login (`users` row) and links it to this student. */
export class CreateParentAccountDto {
  @IsEmail({}, { message: 'Please provide a valid email address' })
  email: string;

  @IsOptional()
  @IsString()
  @Matches(/^[0-9+\-\s()]{7,20}$/, {
    message: 'Please provide a valid phone number',
  })
  phone?: string;

  @IsIn(RELATIONSHIPS, { message: 'relationship must be father, mother, or guardian' })
  relationship: (typeof RELATIONSHIPS)[number];
}
