import { PartialType, OmitType } from '@nestjs/mapped-types';
import { CreateStudentEntrepreneurshipDto } from './create-student-entrepreneurship.dto';

/**
 * EDC Coordinator's venture-edit form (mentor assignment, funding fields,
 * progress flags, etc.) — every field from the create DTO except
 * `student_id`, which never changes after the venture is created.
 */
export class UpdateStudentEntrepreneurshipDto extends PartialType(
  OmitType(CreateStudentEntrepreneurshipDto, ['student_id'] as const),
) {}
