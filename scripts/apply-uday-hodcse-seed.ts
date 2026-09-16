import 'dotenv/config';
import { readFileSync } from 'fs';
import { join } from 'path';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });

async function run() {
  const sqlPath = join(__dirname, '..', 'prisma', 'manual-sql', 'seed_uday_hodcse_faculty.sql');
  const sql = readFileSync(sqlPath, 'utf8');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    console.log('Running seed_uday_hodcse_faculty.sql in a transaction...');
    await client.query(sql);
    await client.query('COMMIT');
    console.log('COMMIT ok.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('ROLLED BACK due to error:', err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
