import { PartialType, OmitType } from '@nestjs/mapped-types';
import { AddVersionVenueDto } from './add-version-venue.dto';

/** venue_id is immutable once added — remove and re-add instead of reassigning. */
export class UpdateVersionVenueDto extends PartialType(
  OmitType(AddVersionVenueDto, ['venue_id'] as const),
) {}
