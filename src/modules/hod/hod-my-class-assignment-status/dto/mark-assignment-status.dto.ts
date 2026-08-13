import { IsBoolean, IsInt, IsOptional } from 'class-validator';

/**
 * PATCH /hod/my-class/assignment-status/mark (HoD only, own assignments).
 * `status_id` null/omitted means no student_assignment_status row exists
 * yet for this (assignment, student) pair — the service creates one instead
 * of updating, same POST-vs-PATCH branch the mobile client already uses
 * directly against /student-assignment-status.
 */
export class MarkAssignmentStatusDto {
  @IsInt()
  assignment_id: number;

  @IsInt()
  student_id: number;

  @IsOptional()
  @IsInt()
  status_id?: number;

  @IsBoolean()
  is_submitted: boolean;
}
