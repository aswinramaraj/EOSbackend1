import 'dotenv/config';
import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { PrismaClient } from '../../generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool, type PoolClient } from 'pg';

const POOL_SIZE = 20;

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);
  private readonly pool: Pool;

  constructor() {
    const connectionString = process.env.DATABASE_URL!;

    // The Supabase pooler this project points at (session mode, port 5432)
    // enforces its own connection ceiling, shared with PostgREST/pg_cron/etc.
    // Live testing showed the *count* of concurrent connections isn't the
    // real problem — sustained bursts against an already-open pool never
    // failed. What reliably triggered EMAXCONNSESSION was a page load's
    // several simultaneous requests each opening a brand-new physical
    // connection to the pooler at the same instant (a cold pool, e.g. right
    // after boot or after node-postgres's default idleTimeoutMillis closed
    // everything). Opening several connections to this pooler at once hits
    // a lower, separate concurrent-handshake limit than the advertised
    // session ceiling — sequential opens never failed in testing.
    //
    // Fix: construct our own pg.Pool (rather than letting PrismaPg build
    // one from a config object) so we can pre-warm it — open all POOL_SIZE
    // connections one at a time at boot (see warmPool below), then hold
    // them open forever (idleTimeoutMillis: 0) so the app never needs to
    // open a new connection concurrently with another again.
    const pool = new Pool({
      connectionString,
      max: POOL_SIZE,
      idleTimeoutMillis: 0,
    });

    const adapter = new PrismaPg(pool);

    // Prisma's own defaults (maxWait: 2000ms to acquire a connection,
    // timeout: 5000ms for the transaction body to finish) are too tight for
    // a pool this small under real concurrent load — raised so a
    // `$transaction` waits out brief contention instead of failing with a
    // 500 the moment every connection is briefly busy.
    super({
      adapter,
      transactionOptions: { maxWait: 10_000, timeout: 15_000 },
    });

    this.pool = pool;

    // node-postgres emits 'error' on the *pool* (not the individual client)
    // when an already-idle, checked-in connection is severed by the network
    // or by the far side (Supabase's pooler recycling a connection under
    // it). With no listener registered, Node's default handling for an
    // unhandled EventEmitter 'error' event is to throw — which crashes the
    // entire process on what is otherwise a routine, recoverable blip (the
    // pool transparently replaces the dead connection on the next checkout;
    // see https://node-postgres.com/apis/pool#error). Logging here is the
    // fix, not a no-op — it's what turns "whole server crashes" into "one
    // line in the log."
    this.pool.on('error', (err) => {
      this.logger.error(
        'Idle Postgres connection in the pool was terminated unexpectedly — pool will replace it automatically.',
        err,
      );
    });
  }

  async onModuleInit() {
    await this.$connect();
    await this.warmPool();
  }

  /**
   * Opens all POOL_SIZE physical connections one at a time (never
   * concurrently) so the pooler never sees more than one brand-new
   * connection attempt at once. Each connection is held open (not
   * released) until every slot is warm, then all are released back —
   * idleTimeoutMillis: 0 keeps them open for the rest of the process's
   * life, so real traffic only ever reuses already-open connections.
   */
  private async warmPool() {
    const clients: PoolClient[] = [];
    try {
      for (let i = 0; i < POOL_SIZE; i++) {
        clients.push(await this.pool.connect());
      }
      this.logger.log(`Pre-warmed ${clients.length} database connections.`);
    } catch (error) {
      this.logger.warn(
        `Pool warm-up stopped after ${clients.length}/${POOL_SIZE} connections: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    } finally {
      for (const client of clients) client.release();
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
