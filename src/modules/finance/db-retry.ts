import { Logger, ServiceUnavailableException } from '@nestjs/common';

/**
 * Retry helper for finance writes, and a shared classifier for "the database
 * was briefly unreachable" as opposed to "this request was wrong".
 *
 * The global TransientDbRetryInterceptor only retries reads, because replaying
 * a write could apply it twice. Some finance writes are nevertheless *provably*
 * safe to retry, and those — and only those — use `withDbRetry` here:
 *
 *   * approving a proposal: the whole thing is one transaction whose first step
 *     is `UPDATE ... WHERE status = 'pending'`. If an earlier attempt actually
 *     committed, the retry matches zero rows and returns a conflict instead of
 *     debiting the fund again.
 *   * creating a fund / starting tracking: both are protected by a unique
 *     constraint, so a duplicate attempt fails on the constraint.
 *
 * Anything that appends a row with no natural key — posting a ledger
 * adjustment, recording an allotment — is deliberately NOT retried, because a
 * replay would genuinely duplicate it. Those surface the clear message below
 * so the user knows to retry deliberately rather than seeing "Something went
 * wrong."
 */

const TRANSIENT_CODES = new Set([
  'ETIMEDOUT',
  'ECONNREFUSED',
  'ECONNRESET',
  'EPIPE',
  'EHOSTUNREACH',
  'ENOTFOUND',
  'P1001',
  'P1002',
  'P1008',
  'P1017',
  '08006',
  '08001',
  '57P01',
]);

const TRANSIENT_TEXT = [
  'max clients reached',
  "can't reach database server",
  'connection refused',
  'connection terminated',
  'connection closed',
  'server closed the connection',
  'timeout exceeded when trying to connect',
  'connection pool timeout',
  'etimedout',
];

/** True when the failure is the connection, not the query. */
export function isTransientDbError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: unknown; message?: unknown; cause?: unknown };

  if (typeof e.code === 'string' && TRANSIENT_CODES.has(e.code)) return true;

  const msg = typeof e.message === 'string' ? e.message.toLowerCase() : '';
  if (msg && TRANSIENT_TEXT.some((t) => msg.includes(t))) return true;

  if (e.cause && e.cause !== err) return isTransientDbError(e.cause);
  return false;
}

/**
 * The error to show when a write could not be attempted because the database
 * was unreachable. 503 (not 500) is accurate — nothing was wrong with the
 * request, and retrying is the correct response.
 */
export function dbUnavailable(): ServiceUnavailableException {
  return new ServiceUnavailableException({
    message:
      'Could not reach the database just now. Nothing was changed — please try again.',
    errorCode: 'FINANCE_DB_UNAVAILABLE',
  });
}

/**
 * Runs `fn`, retrying only transient connection faults. Use ONLY for
 * operations that are safe to replay (see the note at the top of this file).
 */
export async function withDbRetry<T>(
  fn: () => Promise<T>,
  context: string,
  logger: Logger,
  attempts = 5,
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (!isTransientDbError(err)) throw err;

      if (attempt === attempts) break;
      const waitMs = Math.min(1500, 250 * 2 ** (attempt - 1));
      logger.warn(
        `Transient database fault while ${context} — retry ${attempt}/${attempts - 1} in ${waitMs}ms`,
      );
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }

  logger.error(`Database unreachable while ${context}`, lastError as Error);
  throw dbUnavailable();
}
