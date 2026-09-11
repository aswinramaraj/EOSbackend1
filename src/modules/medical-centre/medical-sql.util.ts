import { BadRequestException } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';

export interface UpdateField {
  /** Fixed column name from code, never user input — which is what makes Prisma.raw safe. */
  column: string;
  value: unknown;
}

/**
 * Builds `col = $1, col = $2` from the fields actually supplied, and refuses an
 * empty body.
 *
 * PATCH here is partial: `undefined` means "leave alone", so editing one field
 * cannot blank out the rest. An explicit null is kept, because clearing a field
 * is a real edit. A body with nothing in it is a caller mistake, and `UPDATE
 * ... SET` with no assignments is a syntax error, so it is rejected up front.
 */
export function requireUpdateSet(fields: UpdateField[]): Prisma.Sql {
  const present = fields.filter((f) => f.value !== undefined);
  if (present.length === 0) {
    throw new BadRequestException({
      message: 'No fields provided to update',
      errorCode: 'VALIDATION_ERROR',
    });
  }
  return Prisma.join(
    present.map((f) => Prisma.sql`${Prisma.raw(f.column)} = ${f.value}`),
    ', ',
  );
}
