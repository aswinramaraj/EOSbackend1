import { PartialType, OmitType } from '@nestjs/mapped-types';
import { AddCompetitionEntryDto } from './add-competition-entry.dto';

/** student_id can't be reassigned here — delete + re-add for that, same convention as UpdateAchievementDto. */
export class UpdateCompetitionEntryDto extends PartialType(
  OmitType(AddCompetitionEntryDto, ['student_id'] as const),
) {}
