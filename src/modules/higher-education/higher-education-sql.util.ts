import { BadRequestException } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';

export interface UpdateField {
  /**
   * Column name. Always a fixed string from code — never user input — which is
   * what makes Prisma.raw safe here. Values stay parameterised.
   */
  column: string;
  value: unknown;
  /**
   * Set to false to drop the field even when a value was supplied, for columns
   * this database may not have yet (see detectHigherEducationSchema).
   */
  allowed?: boolean;
  /** Optional cast for enum columns, e.g. 'higher_education_admission_status_enum'. */
  cast?: string;
}

/**
 * Builds `col_a = $1, col_b = $2` from the fields that were actually supplied.
 *
 * PATCH bodies here are partial: a caller editing only a name must not blank
 * out every other column, so `undefined` means "leave alone" and is skipped.
 * An explicit `null` is kept, because clearing a field is a real edit.
 */
export function buildUpdateSet(fields: UpdateField[]): Prisma.Sql | null {
  const present = fields.filter(
    (f) => f.value !== undefined && f.allowed !== false,
  );
  if (present.length === 0) return null;

  return Prisma.join(
    present.map((f) =>
      f.cast
        ? Prisma.sql`${Prisma.raw(f.column)} = ${f.value}::${Prisma.raw(f.cast)}`
        : Prisma.sql`${Prisma.raw(f.column)} = ${f.value}`,
    ),
    ', ',
  );
}

/**
 * Same as buildUpdateSet but refuses an empty body outright. A PATCH that
 * changes nothing is a caller mistake, and issuing `UPDATE ... SET` with no
 * assignments is a syntax error — better to say so than to fail obscurely.
 */
export function requireUpdateSet(fields: UpdateField[]): Prisma.Sql {
  const set = buildUpdateSet(fields);
  if (!set) {
    throw new BadRequestException({
      message: 'No fields provided to update',
      errorCode: 'VALIDATION_ERROR',
    });
  }
  return set;
}
