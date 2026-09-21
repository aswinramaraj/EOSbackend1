/**
 * With the pg driver adapter (Prisma 7), a raw Postgres error from
 * $queryRaw/$executeRaw doesn't surface as a bare `err.code` — it's wrapped
 * as a PrismaClientKnownRequestError with its own code ('P2010'), and the
 * real Postgres SQLSTATE is buried under `err.meta.driverAdapterError.cause`
 * (first found in transport-bus-write.service.ts, reused verbatim since —
 * see canteen-ordering.service.ts). Check every shape, plus a
 * message-substring fallback, so this keeps working regardless of exactly
 * how a given Prisma version/path surfaces it.
 */
export function pgErrorMatches(
  err: unknown,
  sqlState: string,
  messageHint: string,
): boolean {
  const e = err as {
    code?: string;
    message?: string;
    meta?: {
      code?: string;
      driverAdapterError?: { cause?: { originalCode?: string } };
    };
  } | null;
  if (e?.code === sqlState) return true;
  if (e?.meta?.code === sqlState) return true;
  if (e?.meta?.driverAdapterError?.cause?.originalCode === sqlState) {
    return true;
  }
  return (e?.message ?? '').includes(messageHint);
}

/** Postgres SQLSTATE 42703 — undefined_column. Use to detect an additive
 * column proposed via a `.query.md` handoff that hasn't been applied yet. */
export function isUndefinedColumnError(
  err: unknown,
  columnHint: string,
): boolean {
  return pgErrorMatches(err, '42703', columnHint);
}
