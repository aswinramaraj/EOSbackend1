import { Type } from 'class-transformer';
import {
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
} from 'class-validator';

/**
 * POST /me/service-requests (Secretary only).
 *
 * Backed by the existing service_indents + service_order_proposals tables
 * (see ServiceRequestsService) - mirrors CreatePurchaseRequestDto exactly,
 * see its own doc comment for why department_id is client-supplied.
 *
 * `title` is a new nullable column added to service_indents (it had none -
 * only a single service_description text field) purely so the "AC repair"/
 * "Housekeeping"/etc. chip label picked on the mobile form has somewhere
 * structured to live, separate from the free-text complaint details.
 */
export class CreateServiceRequestDto {
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  department_id: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  title: string;

  @IsString()
  @IsNotEmpty()
  service_description: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  quantity?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  location?: string;

  @IsOptional()
  @IsDateString()
  needed_by?: string;
}
