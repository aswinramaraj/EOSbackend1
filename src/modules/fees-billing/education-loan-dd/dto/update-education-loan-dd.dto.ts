import { PartialType } from '@nestjs/mapped-types';
import { IsEnum, IsOptional } from 'class-validator';
import { dd_status_enum } from '../../../../../generated/prisma/client';
import { CreateEducationLoanDdDto } from './create-education-loan-dd.dto';

export class UpdateEducationLoanDdDto extends PartialType(
  CreateEducationLoanDdDto,
) {
  @IsOptional()
  @IsEnum(dd_status_enum)
  status?: dd_status_enum;
}
