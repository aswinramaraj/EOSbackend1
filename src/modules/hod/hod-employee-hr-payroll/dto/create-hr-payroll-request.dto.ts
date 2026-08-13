import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

/** POST /hod/employee/hr-payroll/requests */
export class CreateHrPayrollRequestDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  category: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  subject: string;

  @IsOptional()
  @IsString()
  description?: string;
}
