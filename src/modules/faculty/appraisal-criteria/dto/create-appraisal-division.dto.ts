import { IsString, MaxLength } from 'class-validator';

/** POST /appraisal-divisions (Admin/HR Payroll only) — a Criteria Library category. */
export class CreateAppraisalDivisionDto {
  @IsString()
  @MaxLength(100)
  name: string;
}
