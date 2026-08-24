import 'dotenv/config';
import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '../../generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

/**
 * Reads a numeric setting from DATABASE_URL's query string so the pool can be
 * tuned without a code change. Previously `max` was hardcoded here, which
 * silently overrode `connection_limit=` in the URL — changing the URL appeared
 * to do nothing.
 */
function urlParam(connectionString: string, key: string): number | undefined {
  const match = new RegExp(`[?&]${key}=(\\d+)`).exec(connectionString);
  return match ? Number(match[1]) : undefined;
}

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private static readonly bootLogger = new Logger(PrismaService.name);

  constructor() {
    const connectionString = process.env.DATABASE_URL!;

    // The Supabase pooler this project points at (session mode, port 5432)
    // caps total *client* connections at 15, and that budget is shared with
    // Supabase's own services — PostgREST, pg_net, pg_cron, the metrics
    // exporter and the auth query connection together hold ~6 of it at all
    // times. Anything this app holds is subtracted from what is left, and once
    // the ceiling is reached the pooler stops accepting connections outright,
    // which surfaces as ETIMEDOUT on the very next query.
    //
    // 4 leaves genuine headroom for a psql session and for reconnects after a
    // dropped TCP connection, while still covering the concurrent-query bursts
    // the heavier pages make (the dashboard's batched queries are capped at 3).
    const max = urlParam(connectionString, 'connection_limit') ?? 4;

    const adapter = new PrismaPg({
      connectionString,
      max,
      // Bound how long a caller waits for a free connection instead of hanging
      // until Prisma's own timeout fires.
      connectionTimeoutMillis: urlParam(connectionString, 'pool_timeout')
        ? urlParam(connectionString, 'pool_timeout')! * 1000
        : 15_000,
      // Recycle idle connections. Without this a connection the pooler has
      // already discarded stays in the local pool and fails on next use.
      idleTimeoutMillis: 30_000,
      // Detect half-open TCP connections (the failure mode when the network
      // drops mid-session) rather than waiting for a query to time out.
      keepAlive: true,
    });

    super({ adapter });

    PrismaService.bootLogger.log(
      `Prisma pool: max=${max}, keepAlive on, idle recycle 30s`,
    );
  }

  async onModuleInit() {
    // Do not let a flaky first connection stop the whole app from booting —
    // Prisma reconnects lazily on the next query anyway.
    try {
      await this.$connect();
    } catch (err) {
      PrismaService.bootLogger.warn(
        `Initial database connect failed (${(err as Error).message}). ` +
          'The app will keep serving and reconnect on demand.',
      );
    }

    // Warm the pool in the background. Without this the first real request
    // (in practice a login) pays the cost of opening a connection, and on an
    // unreliable link that is exactly the request most likely to fail — which
    // is what made the very first login after a restart return a 500 while
    // every later one succeeded. Retried, and deliberately not awaited, so a
    // slow warm-up never delays startup.
    void this.warmUp();
  }

  /** Opens a few connections up front, tolerating a flaky link. */
  private async warmUp(): Promise<void> {
    const attempts = 6;
    for (let i = 1; i <= attempts; i++) {
      try {
        await this.$queryRaw`SELECT 1`;
        PrismaService.bootLogger.log(`Database pool warm (attempt ${i})`);
        return;
      } catch {
        if (i === attempts) {
          PrismaService.bootLogger.warn(
            'Could not warm the database pool; requests will connect on demand.',
          );
          return;
        }
        await new Promise((r) => setTimeout(r, Math.min(2000, 300 * 2 ** (i - 1))));
      }
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
