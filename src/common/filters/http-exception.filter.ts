import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { Request, Response } from 'express';

/**
 * Maps HTTP status codes → default errorCode strings.
 * Individual exceptions can override this by setting `response.errorCode`.
 */
const DEFAULT_ERROR_CODES: Record<number, string> = {
  400: 'VALIDATION_ERROR',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  429: 'RATE_LIMIT_EXCEEDED',
  500: 'INTERNAL_ERROR',
};

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    // ── Determine status ────────────────────────────────────────────────────
    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    if (exception instanceof ThrottlerException) {
      status = HttpStatus.TOO_MANY_REQUESTS; // 429
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
    }

    // ── Extract message & errorCode from the thrown exception ───────────────
    const exceptionResponse =
      exception instanceof HttpException ? exception.getResponse() : null;

    let message: string | string[] = 'Something went wrong. Please try again.';
    let errorCode: string = DEFAULT_ERROR_CODES[status] ?? 'INTERNAL_ERROR';

    if (exception instanceof ThrottlerException) {
      message = 'Too many login attempts. Try again later.';
      errorCode = 'RATE_LIMIT_EXCEEDED';
    } else if (
      typeof exceptionResponse === 'object' &&
      exceptionResponse !== null
    ) {
      const r = exceptionResponse as any;
      // message: could be a string or an array (from class-validator)
      message = r.message ?? message;
      // errorCode: can be set explicitly when throwing (e.g. new HttpException({ ..., errorCode: 'INVALID_CREDENTIALS' }, 401))
      errorCode = r.errorCode ?? errorCode;
    } else if (typeof exceptionResponse === 'string') {
      message = exceptionResponse;
    } else if (exception instanceof Error && status >= 500) {
      // Hide raw 500 messages from clients
      message = 'Something went wrong. Please try again.';
    }

    // ── Logging ─────────────────────────────────────────────────────────────
    if (status >= 500) {
      this.logger.error(
        `[${request.method}] ${request.url} → ${status}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    } else {
      this.logger.warn(
        `[${request.method}] ${request.url} → ${status} [${errorCode}]`,
      );
    }

    // ── Response ─────────────────────────────────────────────────────────────
    response.status(status).json({
      success: false,
      statusCode: status,
      errorCode,
      message,
      timestamp: new Date().toISOString(),
      path: request.url,
    });
  }
}
