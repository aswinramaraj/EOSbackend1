import { PartialType } from '@nestjs/mapped-types';
import { CreateReportDto } from './create-report.dto';

/** PATCH /sports-admin/reports/:id (Sports Admin/Admin only). */
export class UpdateReportDto extends PartialType(CreateReportDto) {}
