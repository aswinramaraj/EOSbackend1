import 'dotenv/config';
import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '../../generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor() {
    const connectionString = process.env.DATABASE_URL!;

    // The Supabase pooler this project points at (session mode, port 5432)
    // caps total client connections at 15, shared with PostgREST/pg_cron/etc.
    // A single Nest instance has no business holding more than a handful of
    // those, so `max` is capped well below the pooler's ceiling — raised
    // from 5 to 8 as the app grew more pages that fire several queries at
    // once (dashboard/sidebar badge counts alone are 7 concurrent requests),
    // which was exhausting a 5-connection pool and surfacing as "Unable to
    // start a transaction in the given time" on whichever endpoint lost the
    // race for a connection.
    const adapter = new PrismaPg({
      connectionString,
      max: 8,
    });

    // Prisma's own defaults (maxWait: 2000ms to acquire a connection,
    // timeout: 5000ms for the transaction body to finish) are too tight for
    // a pool this small under real concurrent load — raised so a
    // `$transaction` waits out brief contention instead of failing with a
    // 500 the moment every connection is briefly busy.
    super({ adapter, transactionOptions: { maxWait: 10_000, timeout: 15_000 } });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
