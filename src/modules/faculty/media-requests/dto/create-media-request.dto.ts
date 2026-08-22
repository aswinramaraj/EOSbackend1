import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
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
 *
 * event_name/event_date/venue_id/coordinator_name/contact_number/
 * media_types are real columns on `media_requests` that existed on the
 * table already but were never accepted by this DTO — added here (no
 * migration, the columns were simply unused) so the Secretary Portal's
 * richer composer (event name/date/venue/coordinator/media types) has
 * somewhere real to write to, instead of the old `description`-only shape.
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

  /**
   * Real logos/guest-photo/reference-poster attachment, uploaded ahead of
   * create via `POST /media-requests/attachments` (same two-step shape as
   * announcements) — the requester attaches at creation time, not just
   * Media Room afterwards via `UpdateMediaRequestDto`.
   */
  @IsOptional()
  @IsUrl()
  @MaxLength(500)
  media_file_url?: string;
}
