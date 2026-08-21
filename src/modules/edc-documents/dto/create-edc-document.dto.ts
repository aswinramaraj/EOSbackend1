import { IsIn, IsInt, IsOptional, IsString, MaxLength } from 'class-validator';

export const EDC_DOCUMENT_TYPES = [
  'Pitch Deck',
  'Business Plan',
  'Company Registration',
  'Financial Documents',
  'IP Documents',
  'Competition Documents',
] as const;

/**
 * Creates the document RECORD after the file itself has already been
 * uploaded via the existing `POST /announcements/attachments` endpoint
 * (EDC_COORDINATOR already has access to it — same Supabase Storage
 * `StorageService` the rest of the app uses, no new upload path needed).
 * This endpoint just links that uploaded file's key/url/name to a venture.
 */
export class CreateEdcDocumentDto {
  @IsOptional()
  @IsInt()
  student_entrepreneurship_id?: number;

  @IsIn(EDC_DOCUMENT_TYPES)
  document_type: (typeof EDC_DOCUMENT_TYPES)[number];

  @IsString()
  @MaxLength(255)
  file_name: string;

  @IsString()
  @MaxLength(1000)
  file_url: string;

  @IsString()
  @MaxLength(500)
  file_key: string;
}
