/**
 * Shared response shaping for the Media Room module.
 *
 * Two conversions are needed on every payload and are easy to get wrong:
 *
 *  - Postgres NUMERIC arrives as a Prisma Decimal. Left alone it serialises
 *    inconsistently across drivers, so every money column is emitted as a
 *    plain decimal string — which is also what the frontend contract declares
 *    (`invoice_value: string | null`).
 *  - A `@db.Date` column carries no time or zone, but a JS Date serialises to
 *    a full UTC instant. Emitting "YYYY-MM-DD" keeps a stored date from being
 *    displayed as the previous day for viewers behind UTC.
 */

type DecimalLike = { toString(): string };

/** NUMERIC -> decimal string, preserving null. */
export function money(value: DecimalLike | null | undefined): string | null {
  return value === null || value === undefined ? null : value.toString();
}

/** DATE -> "YYYY-MM-DD", preserving null. */
export function dateOnly(value: Date | null | undefined): string | null {
  if (!value) return null;
  return value.toISOString().slice(0, 10);
}

/** TIMESTAMPTZ -> full ISO instant, preserving null. */
export function instant(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

/**
 * The list envelope the Media Room frontend expects. `ready` was designed as a
 * capability flag for the period before these tables existed; the tables are
 * now present, so it is always true and the client renders data instead of its
 * "not configured yet" placeholder.
 */
export interface ReadyList<T> {
  ready: boolean;
  data: T[];
}

export function readyList<T>(data: T[]): ReadyList<T> {
  return { ready: true, data };
}
