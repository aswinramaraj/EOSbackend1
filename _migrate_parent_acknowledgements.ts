import 'dotenv/config';
import { PrismaClient } from './generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

async function main() {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
  const prisma = new PrismaClient({ adapter } as any) as any;

  console.log('1/2: creating leave_parent_acknowledgements...');
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS leave_parent_acknowledgements (
      id SERIAL PRIMARY KEY,
      leave_id INTEGER NOT NULL REFERENCES student_leaves(id) ON DELETE CASCADE,
      parent_user_id INTEGER NOT NULL REFERENCES users(id),
      acknowledged_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT uq_leave_parent_ack UNIQUE (leave_id, parent_user_id)
    );
  `);
  console.log('done.');

  console.log('2/2: creating od_request_parent_acknowledgements...');
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS od_request_parent_acknowledgements (
      id SERIAL PRIMARY KEY,
      od_request_id INTEGER NOT NULL REFERENCES od_requests(id) ON DELETE CASCADE,
      parent_user_id INTEGER NOT NULL REFERENCES users(id),
      acknowledged_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT uq_od_parent_ack UNIQUE (od_request_id, parent_user_id)
    );
  `);
  console.log('done.');

  const check = await prisma.$queryRawUnsafe(
    `SELECT table_name FROM information_schema.tables WHERE table_name IN ('leave_parent_acknowledgements','od_request_parent_acknowledgements');`,
  );
  console.log('verify tables:', JSON.stringify(check));

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
