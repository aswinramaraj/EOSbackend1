import { PartialType, OmitType } from '@nestjs/mapped-types';
import { AddFacultyCertificationEntryDto } from './add-faculty-certification-entry.dto';

/** faculty_id can't be reassigned here — delete + re-add for that, same convention as UpdateAchievementDto. */
export class UpdateFacultyCertificationEntryDto extends PartialType(
  OmitType(AddFacultyCertificationEntryDto, ['faculty_id'] as const),
) {}
