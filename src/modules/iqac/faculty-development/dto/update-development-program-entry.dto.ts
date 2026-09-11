import { PartialType, OmitType } from '@nestjs/mapped-types';
import { AddDevelopmentProgramEntryDto } from './add-development-program-entry.dto';

/** faculty_id can't be reassigned here — delete + re-add for that, same convention as UpdateAchievementDto. */
export class UpdateDevelopmentProgramEntryDto extends PartialType(
  OmitType(AddDevelopmentProgramEntryDto, ['faculty_id'] as const),
) {}
