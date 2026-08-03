import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { clearance_type_enum } from '../../../../generated/prisma/enums';

/**
 * POST /hall-ticket-clearance (Student only).
 *
 * student_id is never client-supplied, even though the spec's example body
 * includes it — derived from @CurrentUser().sub, same pattern as every
 * other self-service create in this codebase (Faculty Leaves, Payslip
 * Requests, etc.) — a student can only ever request clearance for themselves.
 *
 * clearance_type values (fee_due / no_due / library_due) come from
 * schema.prisma's clearance_type_enum, which is purpose-built for this
 * table only — they describe which due is being cleared, not a free-form
 * exception reason.
 */
export class CreateClearanceDto {
  @IsInt()
  exam_id: number;

  @IsEnum(clearance_type_enum)
  clearance_type: clearance_type_enum;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
