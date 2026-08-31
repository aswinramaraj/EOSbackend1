import { PartialType, OmitType } from '@nestjs/mapped-types';
import { AddCertificationEntryDto } from './add-certification-entry.dto';

/** student_id can't be reassigned here — delete + re-add for that, same convention as UpdateAchievementDto. */
export class UpdateCertificationEntryDto extends PartialType(
  OmitType(AddCertificationEntryDto, ['student_id'] as const),
) {}
