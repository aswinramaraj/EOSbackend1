import { ArrayMinSize, IsArray, IsInt, IsOptional, IsString } from 'class-validator';

/**
 * POST /me/classes/:class_id/attendance/recognize (any faculty mapped to
 * teach this subject for this class - same authorization as the existing
 * POST /me/classes/:class_id/attendance). Read-only: returns a draft
 * present/absent suggestion per student, never persists anything - the
 * faculty reviews/corrects it client-side, then commits via the existing
 * markForClass endpoint, unchanged.
 *
 * `images` is optional so this same endpoint doubles as the plain class
 * roster fetch the mobile marking screen needs before any photo is ever
 * taken (and for classes marked manually with the camera skipped
 * entirely) - omitting it (or sending an empty array) skips the CV service
 * call altogether and every student comes back with suggested_status:
 * null ("not analyzed"), rather than defaulting to absent.
 */
export class RecognizeAttendanceDto {
  @IsInt()
  subject_id: number;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  images?: string[];
}
