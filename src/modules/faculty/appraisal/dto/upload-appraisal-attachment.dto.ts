import { Type } from 'class-transformer';
import { IsInt } from 'class-validator';

/**
 * POST /appraisal_requests/:id/attachments (Faculty only, multipart/form-data).
 * Files themselves arrive via FilesInterceptor('files') - this DTO only
 * covers the accompanying text field identifying which division they
 * belong to (appraisal_attachments has no direct link to a specific
 * criteria_id/entry, only to the division as a whole).
 */
export class UploadAppraisalAttachmentDto {
  @Type(() => Number)
  @IsInt()
  division_id: number;
}
