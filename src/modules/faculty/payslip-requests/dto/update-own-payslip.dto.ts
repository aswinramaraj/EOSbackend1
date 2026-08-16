import { IsString, MaxLength } from 'class-validator';

/** PATCH /me/my-payslip-requests/:id — self-edit, purpose only. */
export class UpdateOwnPayslipDto {
  @IsString()
  @MaxLength(255)
  purpose: string;
}
