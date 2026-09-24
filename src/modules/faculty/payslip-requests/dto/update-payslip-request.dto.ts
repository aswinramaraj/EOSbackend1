import { IsIn, IsOptional, IsUrl, MaxLength } from 'class-validator';
import { OptionalRemarks } from 'src/common/dto/decision-reason.dto';

/**
 * PATCH /payslip-requests/:id (HR Payroll only).
 *
 * A state-machine transition (pending -> processed/rejected), not a
 * free-form edit — same shape as Media Requests' review DTO. Approving
 * ('processed') is just HR's go-ahead — it doesn't generate anything here;
 * the faculty module (separate, built later) is where the faculty actually
 * generates their payslip once this is approved. `file_url` is optional
 * and accepted for either transition, but never required - HR can approve
 * immediately with no file and attach one later some other way if needed,
 * or use it directly if they already happen to have a link to hand over.
 */
export class UpdatePayslipRequestDto {
  @IsIn(['processed', 'rejected'])
  status: 'processed' | 'rejected';

  @IsOptional()
  @IsUrl({}, { message: 'file_url must be a valid URL' })
  @MaxLength(500)
  file_url?: string;

  /** Real once decision_reason_columns.query.md's payslip_requests.rejection_reason runs — accepted but silently dropped by the service's $executeRaw fallback until then. */
  @OptionalRemarks()
  rejection_reason?: string;
}
