import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

/**
 * Fixed checklist the Secretary Portal's Media Request form offers — small,
 * closed set with no admin-managed CRUD anywhere, so a plain validated list
 * rather than a lookup table (same reasoning as the `TEXT[]` column itself).
 */
export const MEDIA_REQUEST_TYPES = [
  'Photography',
  'Videography',
  'Live Streaming',
  'Drone Coverage',
  'LED Display Support',
  'Sound System',
  'Stage Photography',
  'Event Highlights',
] as const;

/**
 * POST /media-requests (Faculty / Secretary).
 *
 * workflow.md: "Faculties can request Poster designs and required media
 * related things." — Faculty's original use case is just a free-text
 * `description`. The Secretary Portal's form additionally collects event
 * details, so those are optional here: Faculty's existing `{ description }`
 * payload keeps working unchanged. `requested_by_faculty_id`,
 * `requested_by_user_id` and `status` (always starts 'pending') are never
 * client-supplied.
 */
export class CreateMediaRequestDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  description: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  event_name?: string;

  @IsOptional()
  @IsDateString({}, { message: 'event_date must be a valid ISO date' })
  event_date?: string;

  @IsOptional()
  @IsInt()
  venue_id?: number;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  coordinator_name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  contact_number?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsIn(MEDIA_REQUEST_TYPES, { each: true })
  media_types?: string[];
}
