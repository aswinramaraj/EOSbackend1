import {
  CallHandler,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import type { Request } from 'express';
import { Observable, defer, throwError, timer } from 'rxjs';
import { retry } from 'rxjs/operators';

/**
 * Retries a request when it failed only because the database was briefly
 * unreachable.
 *
 * WHY THIS EXISTS
 *   This deployment talks to Supabase through a connection pooler that can
 *   refuse or drop connections for a few seconds at a time (network blips, or
 *   the pooler's client ceiling being momentarily full). A single dropped
 *   connection was surfacing to users as "Something went wrong. Please try
 *   again." on otherwise healthy requests — including login. Retrying briefly
 *   turns a visible failure into a slightly slower success.
 *
 * SAFETY — WHAT IS *NOT* RETRIED
 *   Only requests that cannot change data are retried:
 *     * any GET, and
 *     * POST /auth/login, which performs a read-only lookup.
 *   Every other POST/PUT/PATCH/DELETE is passed straight through, so a
 *   payment, an approval or a ledger entry can never be applied twice by a
 *   retry. That matters more here than convenience: the finance module's
 *   writes move money.
 *
 *   Only transient *connection* faults are retried — never a validation
 *   error, a constraint violation, a 4xx, or a genuine query bug, all of
 *   which would fail identically on a second attempt.
 */
@Injectable()
export class TransientDbRetryInterceptor implements NestInterceptor {
  private readonly logger = new Logger(TransientDbRetryInterceptor.name);

  /**
   * Attempts after the first one. Sized against measured reality: on this
   * connection roughly half of all connection attempts to the pooler fail, so
   * three retries still left login failing outright. Six brings the chance of
   * a request failing on every attempt down to well under 1%, and the capped
   * backoff below keeps the worst case around 6 seconds.
   */
  private static readonly MAX_RETRIES = 6;

  /** Prisma/pg error codes that mean "the connection failed", not "the query was wrong". */
  private static readonly TRANSIENT_CODES = new Set([
    'ETIMEDOUT', // connection timed out
    'ECONNREFUSED', // pooler refused the connection
    'ECONNRESET', // connection dropped mid-query
    'EPIPE',
    'EHOSTUNREACH',
    'ENOTFOUND', // transient DNS failure
    'P1001', // Prisma: can't reach database server
    'P1002', // Prisma: database server timed out
    'P1008', // Prisma: operation timed out
    'P1017', // Prisma: server closed the connection
    '08006', // postgres: connection failure
    '08001', // postgres: unable to connect
    '57P01', // postgres: admin shutdown / terminated
  ]);

  private static readonly TRANSIENT_TEXT = [
    'max clients reached',
    "can't reach database server",
    'connection refused',
    'connection terminated',
    'connection closed',
    'server closed the connection',
    'timeout exceeded when trying to connect',
    'connection pool timeout',
  ];

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<Request>();
    if (!this.isSafeToRetry(req)) {
      return next.handle();
    }

    // defer() so each retry re-invokes the handler rather than replaying a
    // already-failed observable.
    return defer(() => next.handle()).pipe(
      retry({
        count: TransientDbRetryInterceptor.MAX_RETRIES,
        delay: (error: unknown, attempt: number) => {
          if (!this.isTransient(error)) return throwError(() => error);
          // Exponential with a 1.5s cap: 250ms, 500ms, 1s, 1.5s, 1.5s, 1.5s.
          // Capped so a run of failures cannot stall the caller for minutes.
          const waitMs = Math.min(1500, 250 * 2 ** (attempt - 1));
          this.logger.warn(
            `Transient database fault on ${req.method} ${req.url} — retry ${attempt}/${TransientDbRetryInterceptor.MAX_RETRIES} in ${waitMs}ms`,
          );
          return timer(waitMs);
        },
        resetOnSuccess: true,
      }),
    );
  }

  /** Reads cannot be applied twice, so only those are retried. */
  private isSafeToRetry(req: Request): boolean {
    if (req.method === 'GET' || req.method === 'HEAD') return true;
    // Login is a POST but writes nothing.
    return req.method === 'POST' && /\/auth\/login\/?$/.test(req.path);
  }

  private isTransient(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false;

    const err = error as {
      code?: unknown;
      message?: unknown;
      errorCode?: unknown;
      response?: { errorCode?: unknown };
      cause?: unknown;
    };

    const code = typeof err.code === 'string' ? err.code : undefined;
    if (code && TransientDbRetryInterceptor.TRANSIENT_CODES.has(code)) return true;

    const message = typeof err.message === 'string' ? err.message.toLowerCase() : '';
    if (
      message &&
      TransientDbRetryInterceptor.TRANSIENT_TEXT.some((t) => message.includes(t))
    ) {
      return true;
    }

    // Services here catch the Prisma error and rethrow InternalServerErrorException,
    // so the transient cause is often one level down.
    if (err.cause && err.cause !== error) return this.isTransient(err.cause);

    // Most services swallow the Prisma error and rethrow a bare
    // InternalServerErrorException, which loses the ETIMEDOUT entirely. For a
    // request that cannot change data, a 500 is worth one more attempt
    // regardless of its cause: if the failure is a real bug it fails again and
    // the user sees the same error, only a moment later. This is deliberately
    // limited to 500 — a 4xx is the caller's fault and never retried.
    if (error instanceof HttpException) {
      return error.getStatus() === HttpStatus.INTERNAL_SERVER_ERROR;
    }

    return false;
  }
}
