import { IsIn, IsOptional, IsString } from 'class-validator';

/** PATCH /iqac/student-ods/:id/verify (IQAC only). */
export class VerifyStudentOdDto {
  @IsIn(['awaiting_documents', 'under_review', 'verified'])
  verification_status: 'awaiting_documents' | 'under_review' | 'verified';

  @IsOptional()
  @IsString()
  admin_remarks?: string;
}
