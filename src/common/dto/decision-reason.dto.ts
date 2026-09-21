import { applyDecorators } from '@nestjs/common';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { Transform } from 'class-transformer';

/**
 * Shared validation for a free-text reason field on an approve/reject DTO —
 * every module keeps its own field/column name (remarks, hod_remarks,
 * admin_remarks, reviewer_note, ...), this just standardizes the decorator
 * stack so it isn't re-typed per module. Two shapes, matching the two real
 * patterns already in this codebase (Finance's decide-proposal.dto.ts,
 * Principal's decide-approval.dto.ts):
 *
 * - `RequiredOnReject('decision', 'reject')` — the field must be a non-empty
 *   string when the DTO's discriminator property equals the given value,
 *   and is otherwise optional (an approval may still add a note).
 * - `OptionalRemarks()` — always-optional free text, for flows where a
 *   reason is never mandatory (e.g. an appraisal "send back" note).
 */
export function RequiredOnReject(
  discriminatorKey: string,
  rejectValue: string,
  maxLength = 500,
) {
  return applyDecorators(
    ValidateIf(
      (o: Record<string, unknown>) => o[discriminatorKey] === rejectValue,
    ),
    IsString(),
    IsNotEmpty({ message: 'A reason is required when rejecting' }),
    MaxLength(maxLength),
    Transform(({ value }: { value: unknown }) =>
      typeof value === 'string' ? value.trim() : value,
    ),
  );
}

export function OptionalRemarks(maxLength = 500) {
  return applyDecorators(
    IsOptional(),
    IsString(),
    MaxLength(maxLength),
    Transform(({ value }: { value: unknown }) =>
      typeof value === 'string' ? value.trim() : value,
    ),
  );
}
