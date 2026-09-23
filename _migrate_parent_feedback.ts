import 'dotenv/config';
import { PrismaClient } from './generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

async function main() {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
  const prisma = new PrismaClient({ adapter } as any) as any;

  console.log('1/2: creating parent_feedback_category_enum...');
  await prisma.$executeRawUnsafe(`
    DO $$ BEGIN
      CREATE TYPE parent_feedback_category_enum AS ENUM ('about_student', 'about_college');
    EXCEPTION WHEN duplicate_object THEN null;
    END $$;
  `);
  console.log('done.');

  console.log('2/2: creating parent_feedback table...');
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS parent_feedback (
      id SERIAL PRIMARY KEY,
      parent_user_id INTEGER NOT NULL REFERENCES users(id),
      student_id INTEGER REFERENCES students(id),
      category parent_feedback_category_enum NOT NULL,
      message TEXT NOT NULL,
      rating INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  console.log('done.');

  const check = await prisma.$queryRawUnsafe(
    `SELECT table_name FROM information_schema.tables WHERE table_name = 'parent_feedback';`,
  );
  console.log('verify table:', JSON.stringify(check));

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
