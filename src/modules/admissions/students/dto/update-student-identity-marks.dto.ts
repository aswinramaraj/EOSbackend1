import {
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Min,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class UpdateStudentIdentityMarkDto {
  @IsInt() @Min(1) mark_number: number;
  @IsOptional() @IsString() @MaxLength(255) description?: string;
}

/**
 * PATCH /students/:id/identity-marks (Admin only) — student_identity_marks
 * had no write path at all today (IdentityMarksSection on the profile page
 * renders it read-only). Unlike addresses (a fixed permanent/temporary pair,
 * upserted in place) this is a variable-length list, so the whole set is
 * replaced on every save — deleting rows whose mark_number isn't in the
 * new list, upserting the ones that are. Sending an empty array clears all
 * marks, which is a real, intentional action, not something to silently skip.
 */
export class UpdateStudentIdentityMarksDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpdateStudentIdentityMarkDto)
  identity_marks: UpdateStudentIdentityMarkDto[];
}
