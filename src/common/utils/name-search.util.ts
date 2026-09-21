import { Prisma } from 'generated/prisma/client';

/**
 * Shared helper for "search a person by name" queries. A person's name is
 * almost always stored as separate first_name/last_name columns, but a
 * caller types it as one string ("Malar Sekar") — matching that whole
 * string against first_name alone, or last_name alone, can never succeed,
 * since neither column contains both words. This was independently
 * reimplemented broken (`OR:[{first_name:contains q},{last_name:contains
 * q}]`) in ~24 places across the backend before being extracted here.
 *
 * The fix, already correct in a few places before this extraction (see
 * library/faculty-lookup.service.ts): split the query into words, and
 * require each word to independently match *some* field (first name, last
 * name, or whatever else a given endpoint also searches by) — this is
 * order-independent, so "Malar Sekar" and "Sekar Malar" both match a person
 * stored as first_name="Malar", last_name="Sekar".
 *
 * Each call site still writes its own literal Prisma field references (via
 * the `matchers` callback), so this stays fully type-checked per model
 * instead of trading correctness for a fully-generic dynamic-key helper.
 */

export function splitSearchWords(q: string | undefined | null): string[] {
  return (q ?? '').trim().split(/\s+/).filter(Boolean);
}

/**
 * Builds `{ AND: [{OR: matchers(word1)}, {OR: matchers(word2)}, ...] }` for
 * order-independent multi-word matching. Returns `undefined` for an
 * empty/whitespace-only query so callers can spread it away with `...(x ?? {})`
 * rather than adding an always-true empty AND to their where-clause.
 *
 * `matchers(word)` returns the list of per-word OR conditions — typically
 * `[{first_name:{contains:word,mode:'insensitive'}}, {last_name:{...}}]`,
 * plus any other single-word-matchable field (staff_code, a short id, etc.)
 * relevant to that endpoint. Fields that are naturally a single token
 * (email, a full registration number) should instead be matched against the
 * *whole* original query string in the caller's own OR, not word-by-word.
 */
export function buildMultiWordNameWhere<T extends object>(
  q: string | undefined | null,
  matchers: (word: string) => T[],
): { AND: { OR: T[] }[] } | undefined {
  const words = splitSearchWords(q);
  if (!words.length) return undefined;
  return { AND: words.map((word) => ({ OR: matchers(word) })) };
}

/**
 * Raw-SQL equivalent of `buildMultiWordNameWhere`, for call sites already
 * using `$queryRaw`/`Prisma.sql` rather than the query builder. Builds a
 * bare expression — `(first ILIKE '%w1%' OR last ILIKE '%w1%') AND (first
 * ILIKE '%w2%' OR last ILIKE '%w2%') ...` — order-independent, same as
 * above. Deliberately has no leading `AND` and no wrapping outer parens, so
 * callers can either prepend `AND` themselves to splice it in as a
 * standalone clause, or OR it together with other conditions and rely on
 * SQL's normal AND-binds-tighter-than-OR precedence (`x AND y OR z` already
 * means `(x AND y) OR z`). Returns `Prisma.empty` for a blank query.
 *
 * `firstNameColumn`/`lastNameColumn` must be a trusted, hardcoded column
 * reference (e.g. `Prisma.raw('soa.first_name')`) — never build them from
 * request input.
 */
export function buildMultiWordNameSql(
  q: string | undefined | null,
  firstNameColumn: Prisma.Sql,
  lastNameColumn: Prisma.Sql,
): Prisma.Sql {
  const words = splitSearchWords(q);
  if (!words.length) return Prisma.empty;
  const clauses = words.map(
    (word) =>
      Prisma.sql`(${firstNameColumn} ILIKE ${`%${word}%`} OR ${lastNameColumn} ILIKE ${`%${word}%`})`,
  );
  return Prisma.join(clauses, ' AND ');
}
