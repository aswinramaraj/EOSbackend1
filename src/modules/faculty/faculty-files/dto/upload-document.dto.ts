import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/**
 * Not tightly `@IsIn`'d against a fixed list — the frontend has two
 * separate dropdowns feeding this same field (general document types and
 * qualification document types, see faculty-wizard-config.ts). Backend just
 * guards against empty/oversized values; the dropdowns do the UX-level
 * constraining.
 */
export class UploadDocumentDto {
  @IsString()
  @IsNotEmpty({ message: 'document_type is required' })
  @MaxLength(100)
  document_type: string;
}
