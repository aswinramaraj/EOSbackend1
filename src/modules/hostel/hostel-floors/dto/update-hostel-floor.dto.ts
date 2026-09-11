import { PartialType, OmitType } from '@nestjs/mapped-types';
import { CreateHostelFloorDto } from './create-hostel-floor.dto';

/** block_id can't be reassigned here — moving a floor to a different block would orphan its rooms; delete + re-create for that, same convention as UpdateHostelBlockDto's hostel_id. */
export class UpdateHostelFloorDto extends PartialType(
  OmitType(CreateHostelFloorDto, ['block_id'] as const),
) {}
