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
    // those, so `max` is capped well below the pooler's ceiling.
    const adapter = new PrismaPg({
      connectionString,
      max: 5,
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
