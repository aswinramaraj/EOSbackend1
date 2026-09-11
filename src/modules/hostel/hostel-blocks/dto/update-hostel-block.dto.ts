import { PartialType, OmitType } from '@nestjs/mapped-types';
import { CreateHostelBlockDto } from './create-hostel-block.dto';

/** hostel_id can't be reassigned here — moving a block to a different hostel would orphan its rooms/wardens; delete + re-create for that. */
export class UpdateHostelBlockDto extends PartialType(
  OmitType(CreateHostelBlockDto, ['hostel_id'] as const),
) {}
