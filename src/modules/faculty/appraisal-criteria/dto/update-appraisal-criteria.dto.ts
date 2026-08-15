import { PartialType } from '@nestjs/mapped-types';
import { CreateAppraisalCriteriaDto } from './create-appraisal-criteria.dto';

/** PATCH /appraisal-criteria/:id (Admin/HR Payroll only). All fields optional. */
export class UpdateAppraisalCriteriaDto extends PartialType(
  CreateAppraisalCriteriaDto,
) {}
