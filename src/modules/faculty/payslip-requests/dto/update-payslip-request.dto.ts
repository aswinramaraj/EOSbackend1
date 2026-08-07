import { IsIn, IsOptional, IsUrl, MaxLength } from 'class-validator';

/**
 * PATCH /payslip-requests/:id (HR Payroll only).
 *
 * A state-machine transition (pending -> processed/rejected), not a
 * free-form edit — same shape as Media Requests' review DTO. `file_url` is
 * optional and accepted for either transition, but never required - HR can
 * approve immediately with no file, and attach one later some other way if
 * needed.
 */
export class UpdatePayslipRequestDto {
  @IsIn(['processed', 'rejected'])
  status: 'processed' | 'rejected';

  @IsOptional()
  @IsUrl({}, { message: 'file_url must be a valid URL' })
  @MaxLength(500)
  file_url?: string;
}
