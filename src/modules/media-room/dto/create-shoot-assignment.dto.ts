import { IsDateString, IsInt, IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';

/**
 * Two mutually exclusive creation paths, matching the DB's
 * media_shoot_assignments_source_check constraint:
 *  - media_request_id set  -> tied to a real, approved media request (Media
 *    Requests queue flow).
 *  - event_title set       -> standalone, self-described entry (Academic
 *    Calendar page's "Add media event" flow) — not tied to any real
 *    institution calendar row, since none of that form's fields map to one.
 * Exactly one of the two must be present.
 */
export class CreateShootAssignmentDto {
  @ValidateIf((dto) => !dto.event_title)
  @IsInt()
  media_request_id?: number;

  @ValidateIf((dto) => !dto.media_request_id)
  @IsString()
  @MaxLength(255)
  event_title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  venue?: string;

  @IsOptional()
  @IsInt()
  assigned_to_member_id?: number;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  crew?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  gear_issued?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  output_type?: string;

  @IsOptional()
  @IsDateString()
  scheduled_at?: string;
}
