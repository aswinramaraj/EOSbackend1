import { PartialType, OmitType } from '@nestjs/mapped-types';
import { AddHackathonEntryDto } from './add-hackathon-entry.dto';

/** student_id can't be reassigned here — delete + re-add for that, same convention as UpdateAchievementDto. */
export class UpdateHackathonEntryDto extends PartialType(
  OmitType(AddHackathonEntryDto, ['student_id'] as const),
) {}
