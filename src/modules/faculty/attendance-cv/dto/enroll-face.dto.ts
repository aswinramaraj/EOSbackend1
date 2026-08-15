import { ArrayMinSize, IsArray, IsString } from 'class-validator';

/**
 * POST /me/classes/:class_id/students/:student_id/face-enrollment (advisor
 * only - see AttendanceCvService.enrollStudentFace). Images are
 * "data:image/jpeg;base64,..." data URLs, matching what the Attendance-CV
 * service's own /api/enroll route expects verbatim - this DTO exists only
 * to validate shape before we forward the payload, not to transform it.
 */
export class EnrollFaceDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  images: string[];
}
