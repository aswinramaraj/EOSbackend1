import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export const EDC_DOCUMENT_VERIFICATION_STATUSES = ['Pending', 'Verified', 'Rejected'] as const;

export class ReviewEdcDocumentDto {
  @IsIn(EDC_DOCUMENT_VERIFICATION_STATUSES)
  verification_status: (typeof EDC_DOCUMENT_VERIFICATION_STATUSES)[number];

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reviewer_note?: string;
}
