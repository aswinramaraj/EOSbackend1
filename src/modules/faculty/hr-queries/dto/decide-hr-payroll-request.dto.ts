import { IsOptional, IsString, MaxLength } from 'class-validator';

/** PATCH /hr/payroll-requests/:id/approve | :id/reject - optional note for the requester. */
export class DecideHrPayrollRequestDto {
  @IsOptional()
  @IsString()
  @MaxLength(240)
  note?: string;
}
