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
    // caps total client connections at 15, shared with PostgREST/pg_cron/etc
    // (observed ~5-6 long-lived non-app sessions at any time). A single Nest
    // instance has no business holding most of that budget, but a single
    // busy page (e.g. the student detail view, which fires ~7 concurrent
    // queries across its overview cards) can genuinely need more than 5
    // connections at once — 5 was tipping legitimate bursts into
    // EMAXCONNSESSION. 8 leaves real headroom for that while still keeping
    // well under the pooler's ceiling.
    const adapter = new PrismaPg({
      connectionString,
      max: 8,
    });

    super({ adapter });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
