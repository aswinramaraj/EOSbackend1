import { Prisma } from '../../../generated/prisma/client';

export interface DynamicField {
  /** Column name — always a fixed string from code, never user input, so Prisma.raw is safe here. */
  column: string;
  value: unknown;
  /** Set to false to skip this field even if a value was provided (e.g. the DB doesn't have this column yet). */
  allowed?: boolean;
}

/** Builds `col_a = $1, col_b = $2, ...` from whichever fields actually have a value (and are allowed). */
export function buildDynamicSet(fields: DynamicField[]): Prisma.Sql | null {
  const present = fields.filter((f) => f.value !== undefined && f.allowed !== false);
  if (present.length === 0) return null;
  return Prisma.join(
    present.map((f) => Prisma.sql`${Prisma.raw(f.column)} = ${f.value}`),
    ', ',
  );
}

/** Builds the `(col_a, col_b) VALUES ($1, $2)` pair from whichever fields have a value (and are allowed). */
export function buildDynamicInsert(fields: DynamicField[]): { columns: Prisma.Sql; values: Prisma.Sql } {
  const present = fields.filter((f) => f.value !== undefined && f.allowed !== false);
  return {
    columns: Prisma.join(present.map((f) => Prisma.raw(f.column)), ', '),
    values: Prisma.join(present.map((f) => Prisma.sql`${f.value}`), ', '),
  };
}
