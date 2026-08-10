import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

/**
 * POST /payslip-requests (Faculty only).
 *
 * workflow.md: "Pay slip request can be done by faculty and its processed
 * through HR Department." payslip_requests stores month/year as separate
 * SmallInt columns — this DTO accepts the same single "YYYY-MM" string
 * convention already used by HR Payroll, split server-side.
 * `faculty_id` is never client-supplied — derived from @CurrentUser().sub.
 * `status` always starts 'pending'; `file_url` is null until HR processes it.
 * `purpose` is optional free text (e.g. "Home loan documentation") for HR's
 * context when processing the request.
 */
export class CreatePayslipRequestDto {
  @IsString()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, {
    message: 'month must be in the format YYYY-MM',
  })
  month: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  purpose?: string;
}
