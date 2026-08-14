import { Type } from 'class-transformer';
import { IsBooleanString, IsInt, IsOptional, Min } from 'class-validator';

/**
 * POST /certificates — multipart form (file optional). Numeric fields
 * arrive as strings over multipart, hence the explicit @Type coercion for
 * the ints. `is_available` stays a string + @IsBooleanString (same
 * convention as ListSoaApplicationsQueryDto's has_draft) rather than
 * @Type(() => Boolean), since Boolean("false") is true — a real footgun
 * for a string that's already "true"/"false".
 */
export class CreateCertificateDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  student_id: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  certificate_type_id: number;

  // Attaching a scan is itself evidence the document was collected, so the
  // controller defaults this to true when a file is present — only needs
  // to be sent explicitly when ticking "collected" with no scan attached.
  @IsOptional()
  @IsBooleanString()
  is_available?: string;
}
