import { IsArray, IsDateString, IsInt, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * POST /media-requests (Faculty, Secretary).
 *
 * workflow.md: "Faculties can request Poster designs and required media
 * related things." `requested_by_faculty_id` (Faculty only) and `status`
 * (always starts 'pending') are never client-supplied.
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
  @IsDateString()
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
  @IsString({ each: true })
  media_types?: string[];
}
