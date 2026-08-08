import 'dotenv/config';
import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '../../generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  constructor() {
    const connectionString = process.env.DATABASE_URL!;

    // The Supabase pooler is in session mode with a hard cap of 15 total
    // connections shared across everything hitting this DB (this app,
    // Prisma Studio, etc.) — pg.Pool defaults to `max: 10` per instance,
    // which alone eats most of that budget and causes intermittent
    // "max clients reached" 500s under any concurrent load. Capping this
    // pool low leaves headroom for other consumers; requests beyond the
    // cap queue instead of failing, which is the trade we want here.
    const adapter = new PrismaPg({
      connectionString,
      max: 5,
    });

    super({ adapter });
  }

  async onModuleInit() {
    await this.$connect();
  }
}
