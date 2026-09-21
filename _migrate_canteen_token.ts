import 'dotenv/config';
import { PrismaClient } from './generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

async function main() {
  const adapter = new PrismaPg({ connectionString: process.env.DIRECT_URL! });
  const prisma = new PrismaClient({ adapter } as any) as any;

  // Each statement run standalone (never inside prisma.$transaction) —
  // CREATE INDEX CONCURRENTLY cannot run inside a transaction block.
  console.log('1/3: adding token_date column...');
  await prisma.$executeRawUnsafe(
    `ALTER TABLE canteen_orders ADD COLUMN IF NOT EXISTS token_date DATE;`,
  );
  console.log('done.');

  console.log('2/3: creating idx_canteen_orders_self_active...');
  await prisma.$executeRawUnsafe(
    `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_canteen_orders_self_active
       ON canteen_orders (order_source, status, created_at);`,
  );
  console.log('done.');

  console.log('3/3: creating uq_canteen_orders_token_per_day...');
  await prisma.$executeRawUnsafe(
    `CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_canteen_orders_token_per_day
       ON canteen_orders (token_date, pickup_token)
       WHERE order_source = 'self' AND status <> 'cancelled';`,
  );
  console.log('done.');

  const check = await prisma.$queryRawUnsafe(
    `SELECT column_name, data_type FROM information_schema.columns WHERE table_name='canteen_orders' AND column_name='token_date';`,
  );
  console.log('verify column:', JSON.stringify(check));

  const idxCheck = await prisma.$queryRawUnsafe(
    `SELECT indexname FROM pg_indexes WHERE tablename='canteen_orders' AND indexname IN ('idx_canteen_orders_self_active','uq_canteen_orders_token_per_day');`,
  );
  console.log('verify indexes:', JSON.stringify(idxCheck));

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
